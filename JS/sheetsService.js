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
 * This version uses a flexible '.includes()' check to match headers, making it more robust.
 * @param {string} sheetName The name of the sheet (e.g., 'Checkins').
 * @param {Object} dataObject A key-value object of the data to write (e.g., { FirstName: 'John', LastName: 'Doe' }).
 * @param {Array<Object>} headerMap The header mapping configuration for this data type (e.g., VISITOR_HEADER_MAP).
 * @returns {Promise<Array<any>>} A promise that resolves with an array of values, ordered correctly for the sheet.
 */
export async function prepareRowData(sheetName, dataObject, headerMap) {
    // 1. Fetch the live header row from the sheet.
    const headerResponse = await getSheetValues(`${sheetName}!1:1`);
    const liveHeaders = headerResponse.result.values ? headerResponse.result.values[0] : [];
    console.log("DEBUG: Fetched live headers from sheet:", liveHeaders);


    if (liveHeaders.length === 0) {
        throw new Error(`Could not read headers from sheet: "${sheetName}". The sheet might be empty or missing a header row.`);
    }

    const normalize = (str) => String(str || '').trim().toLowerCase().replace(/\s+/g, ' ');

    // 2. Create a map from the sheet's column index to our canonical data key (e.g., 0 -> 'Timestamp').
    const columnIndexToDataKey = new Map();
    const mappedKeys = new Set(); // To ensure we don't map the same key (e.g., 'FirstName') to multiple columns.

    liveHeaders.forEach((header, index) => {
        const normalizedHeader = normalize(header);

        // Find the first data mapping that matches this header.
        for (const mapping of headerMap) {
            // If this canonical key (e.g., 'FirstName') has already been mapped to a column, skip it.
            if (mappedKeys.has(mapping.key)) {
                continue;
            }

            // Check if any of the key's aliases (e.g., 'first', 'first name') is part of the header.
            const hasMatchingAlias = mapping.aliases.some(alias => normalizedHeader.includes(normalize(alias)));

            if (hasMatchingAlias) {
                columnIndexToDataKey.set(index, mapping.key); // Map this column index to the canonical key.
                mappedKeys.add(mapping.key); // Mark this canonical key as used.
                break; // This header is now claimed. Move to the next header in the sheet.
            }
        }
    });
    
    console.log("DEBUG: Created column index to data key map:", columnIndexToDataKey);

    // 3. Build the row array based on the map we just created.
    const rowData = Array(liveHeaders.length).fill('');
    for (const [index, dataKey] of columnIndexToDataKey.entries()) {
        if (dataObject.hasOwnProperty(dataKey)) {
            rowData[index] = dataObject[dataKey];
        }
    }

    console.log("DEBUG: Prepared row data for submission:", rowData);
    return rowData;
}

