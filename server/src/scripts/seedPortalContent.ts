import prisma from '../lib/prisma';

const ICD11_CODES = [
  { code: '1C62.Z', description: 'HIV disease, unspecified', category: 'Infectious diseases' },
  { code: 'BA80', description: 'Essential hypertension', category: 'Cardiovascular' },
  { code: 'BA81', description: 'Secondary hypertension', category: 'Cardiovascular' },
  { code: '5A11', description: 'Type 2 diabetes mellitus', category: 'Endocrine' },
  { code: '5A10', description: 'Type 1 diabetes mellitus', category: 'Endocrine' },
  { code: 'BA41', description: 'Heart failure, unspecified', category: 'Cardiovascular' },
  { code: 'CB41', description: 'Asthma', category: 'Respiratory' },
  { code: 'DB94.Z', description: 'Chronic kidney disease, unspecified stage', category: 'Renal' },
  { code: 'CB00', description: 'COPD', category: 'Respiratory' },
  { code: '5A20', description: 'Obesity', category: 'Endocrine' },
  { code: '8B10', description: 'Epilepsy', category: 'Neurological' },
];

const CONDITION_LIBRARY = [
  {
    conditionKey: 'hypertension',
    icdPrefixes: 'BA80,BA81',
    matchTerms: 'hypertension',
    plainName: 'High blood pressure',
    plainDescription: "Your blood pressure runs higher than is healthy for your heart and blood vessels over time.",
    tips: [
      'Cutting back on added salt is one of the fastest ways to bring your blood pressure down.',
      'A short walk most days — even 20 minutes — helps your heart work more easily.',
      "Take your blood pressure medication at the same time each day; it works best when it's steady in your system.",
    ],
    mythBusters: [
      { myth: 'If I feel fine, my blood pressure must be fine too.', truth: 'High blood pressure rarely causes symptoms — regular checks are the only way to know.' },
      { myth: 'Once my blood pressure is normal, I can stop my tablets.', truth: 'Your blood pressure is normal because of the tablets — stopping usually brings it back up.' },
    ],
  },
  {
    conditionKey: 'diabetes-type-2',
    icdPrefixes: '5A11',
    matchTerms: 'type 2 diabetes',
    plainName: 'Type 2 diabetes',
    plainDescription: 'Your body has trouble keeping blood sugar in a healthy range.',
    tips: [
      'Pairing starchy foods (nshima, rice, bread) with vegetables or protein slows down sugar spikes.',
      'Regular meals — not skipping — help keep your blood sugar steadier through the day.',
      'A brisk 15-30 minute walk after a meal can measurably lower your sugar reading.',
    ],
    mythBusters: [
      { myth: 'Diabetes means I can never eat sugar again.', truth: "It's about balance and portion, not eliminating every sweet food forever." },
      { myth: 'Only insulin can control type 2 diabetes.', truth: 'Many people manage well with tablets, diet, and activity — insulin is just one tool.' },
    ],
  },
  {
    conditionKey: 'diabetes-type-1',
    icdPrefixes: '5A10',
    matchTerms: 'type 1 diabetes',
    plainName: 'Type 1 diabetes',
    plainDescription: 'Your body does not produce insulin, so you need it from an injection or pump.',
    tips: ['Keep a fast-acting sugar source with you in case your level drops suddenly.'],
    mythBusters: [{ myth: 'Type 1 diabetes was caused by eating too much sugar.', truth: 'Type 1 diabetes is an autoimmune condition — it is not caused by diet.' }],
  },
  {
    conditionKey: 'asthma',
    icdPrefixes: 'CB41',
    matchTerms: 'asthma',
    plainName: 'Asthma',
    plainDescription: 'Your airways are sensitive and can narrow, making it harder to breathe at times.',
    tips: ['Keep your inhaler with you at all times, even on days you feel well.'],
    mythBusters: [{ myth: 'You only need your inhaler when you feel breathless.', truth: 'Your preventer inhaler works best used daily, even without symptoms.' }],
  },
  {
    conditionKey: 'heart-failure',
    icdPrefixes: 'BA41',
    matchTerms: 'heart failure',
    plainName: 'Heart failure',
    plainDescription: "Your heart isn't pumping as efficiently as it should, so fluid can build up.",
    tips: ['Weighing yourself each morning helps catch fluid build-up early — tell your clinician about sudden gains.'],
    mythBusters: [{ myth: 'Heart failure means my heart is about to stop.', truth: 'It means your heart needs support to pump well — many people live long, active lives with treatment.' }],
  },
  {
    conditionKey: 'chronic-kidney-disease',
    icdPrefixes: 'DB94.Z',
    matchTerms: 'chronic kidney disease',
    plainName: 'Chronic kidney disease',
    plainDescription: 'Your kidneys are working less efficiently than they used to.',
    tips: ['Staying well hydrated and keeping blood pressure controlled both help protect your kidneys.'],
    mythBusters: [{ myth: 'Kidney disease always leads to dialysis.', truth: 'Many people manage kidney disease for years through diet, blood pressure control, and medication.' }],
  },
  {
    conditionKey: 'copd',
    icdPrefixes: 'CB00',
    matchTerms: 'copd,chronic obstructive',
    plainName: 'COPD',
    plainDescription: 'Long-term airway narrowing that makes breathing harder over time.',
    tips: ['Pacing activities and using your inhaler as prescribed both help you breathe easier day to day.'],
    mythBusters: [{ myth: 'COPD only affects smokers.', truth: 'Smoking is the leading cause, but other exposures can cause it too.' }],
  },
  {
    conditionKey: 'obesity',
    icdPrefixes: '5A20',
    matchTerms: 'obesity',
    plainName: 'Weight management',
    plainDescription: 'Your weight is at a level that raises your risk for other chronic conditions.',
    tips: ['Small, sustained changes (an extra daily walk, smaller portions) tend to work better long-term than big sudden changes.'],
    mythBusters: [{ myth: 'Rapid weight loss is always healthier.', truth: 'Slow, steady loss is usually easier to maintain and safer for your body.' }],
  },
  {
    conditionKey: 'hiv',
    icdPrefixes: '1C62',
    matchTerms: 'hiv',
    plainName: 'HIV',
    plainDescription: 'Living with HIV, managed with daily antiretroviral treatment.',
    tips: ['Taking your ART at the same time every day keeps your viral load suppressed and protects your immune system.'],
    mythBusters: [{ myth: 'If I feel healthy, I can skip a dose here and there.', truth: 'Missed doses are the most common reason treatment stops working — consistency matters more than how you feel.' }],
  },
];

async function main() {
  await prisma.iCD11Code.createMany({ data: ICD11_CODES, skipDuplicates: true });
  console.log(`Seeded ${ICD11_CODES.length} ICD-11 codes (skipping duplicates).`);

  for (const entry of CONDITION_LIBRARY) {
    await prisma.conditionContent.upsert({
      where: { conditionKey: entry.conditionKey },
      create: entry,
      update: entry,
    });
  }
  console.log(`Seeded ${CONDITION_LIBRARY.length} condition content entries.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
