# Facility settings

**Administration → Facility** holds three things about the facility this installation serves. There is one row (`FacilitySetting`, id 1); a database constraint keeps it that way.

| Setting | Used for |
|---|---|
| Facility name | The header of every report export, beside who generated it, and the Facility row of each Definitions sheet |
| District | Shown with the name: "Mtendere Clinic · Lusaka" |
| Allow patient names on report line lists | When on (the default, as before the setting existed), clinical roles may ask for names on a line list. When off, every line list shows only the patient ID and a masked NRC, for every role, on screen and in Excel |

- `GET /facility-settings`: anyone signed in (nothing in it is about a patient). `PATCH /facility-settings`: admin only. Names are trimmed and limited (120 characters for the name, 80 for the district); anything else is refused with a reason.
- Every change is written to the audit log (`FACILITY_SETTINGS_CHANGED`, with the values before and after, and who made it).
- **The names switch is enforced by the server**, not just hidden on screen: with it off, asking for names on a line list or in an Excel file is refused with "names on report line lists are switched off for this facility", and the report registry tells the screen not to offer the names box. A role that never had names is told that instead.
- If the settings cannot be read, reports still work: they carry no facility name and names stay allowed as before.

## Excel group headings

A report can now declare headings over runs of its columns. The Attendance report uses it, as in the design: "New attendance" over its male, female (other) and total columns, and "Re-attendance" over its own. The column headings move down one row on that sheet only; every other report keeps its layout.

## Checks

`npm run test:facility` (server, 4 groups, disposable schema, real router and signed tokens): the default row and the one-row rule; who may read and change it; every validation message; the audit trail; the facility on the report sheet and the Definitions sheet (and on the overview export), and nothing stray when it is blank; the names switch refusing names on screen and in Excel for every role, the registry no longer offering them, and switching back on. Two rules were broken on purpose (the switch ignored, the facility left off the sheet) to confirm the test notices. The attendance test checks the group headings and that each spans only its own columns.
