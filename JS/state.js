// IMPORTANT: Update this with your actual Google Spreadsheet ID.
export const SPREADSHEET_ID = '112D0IJ7RVyARmVFv_J26xAatSJKphnj-A9M6dp1gWl8';

// The name of the sheet (tab) in your Google Sheet where check-in data is stored.
export const SHEET_NAME = 'Checkins';

/**
 * Defines the canonical data keys and possible header aliases for visitor data.
 * This allows the `prepareRowData` function to correctly map data from the application
 * to the columns in the Google Sheet, even if the column names or order change slightly.
 * For example, if your sheet has a column named "First", it will correctly map to the "FirstName" field.
 */
export const VISITOR_HEADER_MAP = [
    {
        key: 'Timestamp',
        aliases: ['Timestamp', 'Date', 'Time', 'Check-in Time']
    },
    {
        key: 'FirstName',
        aliases: ['First Name', 'First', 'Given Name']
    },
    {
        key: 'LastName',
        aliases: ['Last Name', 'Last', 'Family Name', 'Surname']
    },
    {
        key: 'Email',
        aliases: ['Email', 'Email Address', 'E-mail']
    },
    {
        key: 'Phone',
        aliases: ['Phone', 'Phone Number', 'Contact Number']
    }
];
