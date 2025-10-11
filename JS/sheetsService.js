/* global gapi */
import { SPREADSHEET_ID } from './state.js';

/**
 * Fetches data from a single range.
 * @param {string} range - A single range to fetch data from.
 * @returns {Promise<Object>} A promise that resolves with the raw value range.
 */
export async function getSheetValues(range) {
    return gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
    });
}


/**
 * Fetches metadata and data from all required sheets.
 * @param {string[]} ranges - An array of ranges to fetch data from.
 * @returns {Promise<Object>} A promise that resolves with the raw metadata and value ranges from the sheets.
 */
export async function fetchSheetMetadataAndData(ranges) {
    const metaResponse = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
    });

    const dataResponse = await gapi.client.sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: ranges,
    });

    return {
        meta: metaResponse.result,
        data: dataResponse.result.valueRanges
    };
}

/**
 * Writes a single row of data to a sheet by updating a specific range.
 * @param {string} range The A1 notation of the range to update.
 * @param {Array<Array<any>>} values The data to be written.
 * @returns {Promise<Object>} The response from the Sheets API.
 */
export async function updateSheetValues(range, values) {
    return gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
        valueInputOption: 'USER_ENTERED',
        resource: { values: values }
    });
}

/**
 * Appends a row to a sheet.
 * @param {string} sheetName The name of the sheet.
 * @param {Array<Array<any>>} values The data to be appended.
 * @returns {Promise<Object>} The response from the Sheets API.
 */
export async function appendSheetValues(sheetName, values) {
    return gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetName,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: values }
    });
}

/**
 * Performs a batch update of values in a sheet.
 * @param {Array<Object>} data The data for the batch update request, defining ranges and values.
 * @returns {Promise<Object>} The response from the Sheets API.
 */
export async function batchUpdateSheetValues(data) {
    return gapi.client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            valueInputOption: 'USER_ENTERED',
            data: data
        }
    });
}

/**
 * Performs a general batch update, used here for deleting a row.
 * @param {Object} resource The request body for the batch update.
 * @returns {Promise<Object>} The response from the Sheets API.
 */
export async function batchUpdateSheet(resource) {
    return gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: resource
    });
}

/**
 * Prepares a data object to be written to a sheet, aligning its values with the sheet's current column order.
 * This prevents data corruption if columns are reordered in the Google Sheet.
 * @param {string} sheetName The name of the sheet (e.g., 'Checkins').
 * @param {Object} dataObject A key-value object of the data to write (e.g., { FirstName: 'John', LastName: 'Doe' }).
 * @param {Array<Object>} headerMap The header mapping configuration for this data type (e.g., VISITOR_HEADER_MAP).
 * @returns {Promise<Array<any>>} A promise that resolves with an array of values, ordered correctly for the sheet.
 */
export async function prepareRowData(sheetName, dataObject, headerMap) {
    // 1. Fetch the live header row from the sheet.
    const headerResponse = await getSheetValues(`${sheetName}!1:1`);
    const liveHeaders = headerResponse.result.values ? headerResponse.result.values[0] : [];

    if (liveHeaders.length === 0) {
        throw new Error(`Could not read headers from sheet: "${sheetName}". The sheet might be empty or missing a header row.`);
    }

    // 2. Create a map from normalized header aliases to the canonical data key.
    const aliasToKeyMap = new Map();
    const normalize = (header) => String(header || '').trim().toLowerCase().replace(/\s+/g, ' ');
    
    for (const mapping of headerMap) {
        if (mapping.deprecated) continue; 
        for (const alias of mapping.aliases) {
            aliasToKeyMap.set(normalize(alias), mapping.key);
        }
    }

    // 3. Build the row array based on the live header order.
    const rowData = liveHeaders.map(header => {
        const normalizedHeader = normalize(header);
        const dataKey = aliasToKeyMap.get(normalizedHeader);
        return dataKey && dataObject.hasOwnProperty(dataKey) ? dataObject[dataKey] : '';
    });

    return rowData;
}
