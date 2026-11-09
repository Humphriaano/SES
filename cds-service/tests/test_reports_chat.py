"""The reports assistant reads reports only for a question someone asked, and only the reports that question is about.

Run from cds-service:  .venv\\Scripts\\python.exe -m unittest tests.test_reports_chat -v
No Ollama and no Express are needed: the model call and the report fetches are replaced.
"""
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DATABASE_URL'] = 'postgresql://unused:unused@localhost/unused'
from fastapi.testclient import TestClient
import main

SIGNED_IN = {'Authorization': 'Bearer test-token'}
MODEL_ANSWER = json.dumps({'answer': 'There are 3 patients.', 'responseType': 'text', 'chartType': None})


class FakeResponse:
    def __init__(self, payload, status=200):
        self.status_code, self._payload = status, payload

    def json(self):
        return self._payload


class FakeClient:
    """Stands in for httpx.AsyncClient and remembers every address asked for."""
    asked: list = []
    answers: dict = {}

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, params=None, headers=None):
        FakeClient.asked.append(url)
        for part, payload in FakeClient.answers.items():
            if url.endswith(part):
                return FakeResponse(payload)
        return FakeResponse({})


class ReportsChatRestrictionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.fetch = AsyncMock(return_value={'patients': {'total': 3}})
        self.llm = Mock(return_value=MODEL_ANSWER)
        for patcher in (patch.object(main, 'fetch_population_data', self.fetch), patch.object(main, 'llm_chat', self.llm)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def ask(self, question, history=None, headers=SIGNED_IN):
        return self.client.post('/cds/reports-chat', json={'question': question, 'history': history or []}, headers=headers)

    def assertNothingRan(self):
        self.fetch.assert_not_called()
        self.llm.assert_not_called()

    # ── nothing runs unless someone asked ──────────────────────────────────────
    def test_a_blank_question_runs_nothing(self):
        for blank in ('', '   ', '\n\t'):
            self.assertEqual(self.ask(blank).status_code, 400, repr(blank))
        self.assertNothingRan()

    def test_a_very_long_question_is_refused(self):
        res = self.ask('how many patients ' * 60)
        self.assertEqual(res.status_code, 400)
        self.assertIn('500', res.json()['detail'])
        self.assertNothingRan()

    def test_without_a_login_nothing_is_read(self):
        res = self.ask('How many patients are there?', headers={})
        self.assertEqual(res.status_code, 200)
        self.assertIn('Sign in', res.json()['answer'])
        self.assertNothingRan()

    def test_a_question_that_names_no_topic_reads_nothing_and_says_what_can_be_asked(self):
        for text in ('hello', 'what is the weather today', 'tell me a joke'):
            res = self.ask(text)
            self.assertEqual(res.status_code, 200, text)
            self.assertEqual(res.json()['answer'], main.HELP_REPLY, text)
            self.assertEqual(res.json()['responseType'], 'text')
        self.assertNothingRan()

    # ── only what the question is about ────────────────────────────────────────
    def test_only_the_named_topics_are_fetched(self):
        res = self.ask('Which medications are dispensed most?')
        self.assertEqual(res.status_code, 200)
        needed, billing = self.fetch.call_args.args[:2]
        self.assertEqual(needed, {'medications'})
        self.assertFalse(billing)
        self.llm.assert_called_once()

    def test_billing_is_fetched_only_when_billing_is_asked_about(self):
        self.ask('How much money was collected this month?')
        self.assertTrue(self.fetch.call_args.args[1])
        self.fetch.reset_mock()
        self.ask('How many hypertension patients have controlled blood pressure?')
        self.assertFalse(self.fetch.call_args.args[1])

    def test_a_follow_up_reuses_the_topic_of_the_earlier_question(self):
        history = [
            {'role': 'user', 'content': 'How many chronic disease patients are overdue?'},
            {'role': 'assistant', 'content': 'There are 70.'},
            {'role': 'user', 'content': 'and for women?'},   # the page sends the new question as the last entry too
        ]
        res = self.ask('and for women?', history)
        self.assertEqual(res.status_code, 200)
        self.assertIn('chronic', self.fetch.call_args.args[0])

    def test_a_follow_up_with_nothing_to_follow_reads_nothing(self):
        res = self.ask('and for women?', [{'role': 'user', 'content': 'and for women?'}])
        self.assertEqual(res.json()['answer'], main.HELP_REPLY)
        self.assertNothingRan()

    # ── a smaller prompt ───────────────────────────────────────────────────────
    def prompt_text(self):
        messages = self.llm.call_args.args[0]
        return messages, '\n'.join(m['content'] for m in messages)

    def test_the_question_is_in_the_prompt_once_and_the_data_is_compact(self):
        history = [{'role': 'user', 'content': 'How many patients are there?'}]
        self.ask('How many patients are there?', history)
        messages, text = self.prompt_text()
        self.assertEqual(text.count('How many patients are there?'), 1)
        self.assertIn('{"patients":{"total":3}}', text)
        self.assertNotIn('\n  ', messages[-1]['content'].split('QUESTION')[0], 'no indentation in the data block')

    def test_earlier_answers_are_shortened(self):
        history = [{'role': 'user', 'content': 'How many patients?'}, {'role': 'assistant', 'content': 'x' * 2000}, {'role': 'user', 'content': 'And how many patients are female?'}]
        self.ask('And how many patients are female?', history)
        messages, _ = self.prompt_text()
        self.assertTrue(all(len(m['content']) <= 300 for m in messages[1:-1]))

    def test_vital_sign_time_series_is_left_out_unless_a_trend_is_asked_for(self):
        series = [{'date': '2026-10-01', 'Systolic': 120}] * 30
        self.fetch.return_value = {'vitals': {'bloodPressureSystolic': {'avg': 124}, 'timeSeries': list(series)}}
        self.ask('What is the average blood pressure?')
        self.assertNotIn('timeSeries', self.prompt_text()[1])
        self.fetch.return_value = {'vitals': {'bloodPressureSystolic': {'avg': 124}, 'timeSeries': list(series)}}
        self.ask('Show the blood pressure trend over time')
        self.assertIn('timeSeries', self.prompt_text()[1])


class TopicTests(unittest.TestCase):
    def test_topics_follow_the_words_of_the_question(self):
        self.assertEqual(main.topics_for('hello there'), (set(), False))
        self.assertEqual(main.topics_for('Show unpaid invoices'), (set(), True))
        needed, billing = main.topics_for('How many hypertension patients are overdue for follow-up?')
        self.assertTrue({'chronic', 'patients'} <= needed and not billing)


class FetchOnlyWhatIsNeededTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeClient.asked = []
        FakeClient.answers = {}
        patcher = patch.object(main.httpx, 'AsyncClient', FakeClient)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_nothing_needed_means_no_request_at_all(self):
        self.assertEqual(await main.fetch_population_data(set(), False, 'hello', 'Bearer x'), {})
        self.assertEqual(FakeClient.asked, [])

    async def test_only_the_needed_reports_are_requested(self):
        await main.fetch_population_data({'chronic'}, False, 'q', 'Bearer x')
        self.assertEqual(len(FakeClient.asked), 1)
        self.assertTrue(FakeClient.asked[0].endswith('/reports/population/chronic'))

    async def test_billing_fetches_are_trimmed(self):
        FakeClient.answers = {'/billing/reports/daybook': {'period': 'x', 'summary': [], 'totals': {}, 'rows': [{'n': i} for i in range(25)]}}
        out = await main.fetch_billing_data('money', 'Bearer x')
        self.assertEqual(len(out['daybook_today']['rows']), 10)


if __name__ == '__main__':
    unittest.main()
