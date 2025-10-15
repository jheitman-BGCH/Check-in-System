// js/state.js
export const SPREADSHEET_ID = '112D0IJ7RVyARmVFv_J26xAatSJKphnj-A9M6dp1gWl8';

// The names of the sheets (tabs) in your Google Sheet.
export const VISITORS_SHEET_NAME = 'Visitors';
export const CHECKINS_SHEET_NAME = 'Checkins';
export const EVENTS_SHEET_NAME = 'Events'; // New: For the events list


/**
 * Defines the canonical data keys and possible header aliases for the 'Visitors' sheet.
 * This allows the `prepareRowData` function to correctly map data from the application
 * to the columns in the Google Sheet, even if the column names or order change slightly.
 */
export const VISITOR_HEADER_MAP = [
    {
        key: 'VisitorID',
        aliases: ['Visitor ID', 'ID', 'VisitorID']
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
    },
    {
        key: 'DateJoined',
        aliases: ['Date Joined', 'Joined', 'DateJoined']
    },
    // Added a new mapping for the mailing list subscription field
    {
        key: 'Subscribed',
        aliases: ['Subscribed', 'Mailing List', 'Subscribe']
    }
];

/**
 * Defines the canonical data keys and possible header aliases for the 'Checkins' sheet.
 */
export const CHECKINS_HEADER_MAP = [
    {
        key: 'Timestamp',
        aliases: ['Timestamp', 'Date', 'Time', 'Check-in Time']
    },
    {
        key: 'VisitorID',
        aliases: ['Visitor ID', 'ID', 'VisitorID']
    },
    {
        key: 'FullName', // Included for easier reading in the check-in log
        aliases: ['Name', 'Full Name', 'Visitor']
    },
    // FIX: Renamed key and updated aliases to avoid conflicts with 'FullName'.
    {
        key: 'EventTitle',
        aliases: ['Event Title', 'Event', 'EventTitle']
    }
];

/**
 * PATCH: Defines the canonical data keys for event-specific guest list sheets.
 * Added 'GuestID' and 'IsWalkin' to support the new check-in requirements.
 */
export const GUEST_HEADER_MAP = [
    {
        key: 'GuestID',
        aliases: ['Guest ID', 'GuestID', 'Visitor ID', 'VisitorID']
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
    },
    {
        key: 'CheckinTimestamp',
        aliases: ['Check-in Time', 'Checkin Timestamp', 'Checked In', 'CheckinTimestamp']
    },
    {
        key: 'IsWalkin',
        aliases: ['Is Walk-in', 'Is Walkin', 'Walk-in', 'Walkin']
    }
];
