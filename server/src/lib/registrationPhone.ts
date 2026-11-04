// Mobile-number lengths from Google's libphonenumber metadata (2026-11-03):
// https://github.com/google/libphonenumber/blob/master/resources/PhoneNumberMetadata.xml
// Keep this registration-only helper identical in client/src/lib and server/src/lib.
export const REGISTRATION_PHONE_RULES: Readonly<Record<string, { lengths: readonly number[]; nationalPrefix: string }>> = {
  "+260": {
    "lengths": [
      9
    ],
    "nationalPrefix": "0"
  },
  "+27": {
    "lengths": [
      5,
      6,
      7,
      8,
      9
    ],
    "nationalPrefix": "0"
  },
  "+263": {
    "lengths": [
      9
    ],
    "nationalPrefix": "0"
  },
  "+265": {
    "lengths": [
      9
    ],
    "nationalPrefix": "0"
  },
  "+255": {
    "lengths": [
      9
    ],
    "nationalPrefix": "0"
  },
  "+254": {
    "lengths": [
      9
    ],
    "nationalPrefix": "0"
  },
  "+256": {
    "lengths": [
      9
    ],
    "nationalPrefix": "0"
  },
  "+243": {
    "lengths": [
      7,
      9
    ],
    "nationalPrefix": "0"
  },
  "+267": {
    "lengths": [
      8
    ],
    "nationalPrefix": ""
  },
  "+258": {
    "lengths": [
      9
    ],
    "nationalPrefix": ""
  },
  "+266": {
    "lengths": [
      8
    ],
    "nationalPrefix": ""
  },
  "+264": {
    "lengths": [
      9
    ],
    "nationalPrefix": "0"
  },
  "+44": {
    "lengths": [
      10
    ],
    "nationalPrefix": "0"
  },
  "+1": {
    "lengths": [
      10
    ],
    "nationalPrefix": "1"
  },
  "+61": {
    "lengths": [
      9
    ],
    "nationalPrefix": "0"
  },
  "+49": {
    "lengths": [
      10,
      11
    ],
    "nationalPrefix": "0"
  },
  "+33": {
    "lengths": [
      9
    ],
    "nationalPrefix": "0"
  },
  "+91": {
    "lengths": [
      10
    ],
    "nationalPrefix": "0"
  },
  "+86": {
    "lengths": [
      11
    ],
    "nationalPrefix": "0"
  }
};

export function maxPhoneDigits(countryCode: string): number {
  const rule = REGISTRATION_PHONE_RULES[countryCode];
  return rule ? Math.max(...rule.lengths) : 0;
}

// Strip formatting and a matching dialling/trunk prefix, without truncating.
// The server validates the complete result; only the input formatter caps edits.
export function normalizeRegistrationPhone(raw: string, countryCode: string): string {
  const rule = REGISTRATION_PHONE_RULES[countryCode];
  if (!rule) return '';
  let digits = raw.replace(/\D/g, '');
  const dial = countryCode.slice(1), max = maxPhoneDigits(countryCode);
  if (raw.trim().startsWith('+')) {
    if (!digits.startsWith(dial)) return '';
    digits = digits.slice(dial.length);
  } else if (digits.startsWith('00')) {
    if (!digits.slice(2).startsWith(dial)) return '';
    digits = digits.slice(2 + dial.length);
  } else if (digits.length > max && digits.startsWith(dial)) {
    digits = digits.slice(dial.length);
  }
  if (rule.nationalPrefix && digits.startsWith(rule.nationalPrefix) && (rule.nationalPrefix === '0' || digits.length > max)) {
    digits = digits.slice(rule.nationalPrefix.length);
  }
  return digits;
}

export const formatRegistrationPhone = (raw: string, countryCode: string): string =>
  normalizeRegistrationPhone(raw, countryCode).slice(0, maxPhoneDigits(countryCode));

export function validateRegistrationPhone(countryCode: unknown, raw: unknown): { countryCode: string; number: string; error: string | null } {
  if (typeof countryCode !== 'string' || !Object.prototype.hasOwnProperty.call(REGISTRATION_PHONE_RULES, countryCode)) return { countryCode: '', number: '', error: 'Choose a supported country code.' };
  if (typeof raw !== 'string' || !raw.trim()) return { countryCode, number: '', error: 'Phone number is required' };
  if (!/^[+()\d\s.-]+$/.test(raw)) return { countryCode, number: '', error: 'Phone number must contain digits only.' };
  const number = normalizeRegistrationPhone(raw, countryCode), lengths = REGISTRATION_PHONE_RULES[countryCode].lengths;
  const lengthLabel = lengths.length === 1 ? String(lengths[0]) : lengths.join(' or ');
  return { countryCode, number, error: lengths.includes(number.length) ? null : 'Phone number must be ' + lengthLabel + ' digits after ' + countryCode + '.' };
}
