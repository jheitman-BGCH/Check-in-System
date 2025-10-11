import { CLIENT_ID, DISCOVERY_DOC, SCOPES } from './JS/authConfig.js';
import { SHEET_NAME, VISITOR_HEADER_MAP } from './JS/state.js';
import { getSheetValues, appendSheetValues, prepareRowData } from './JS/sheetsService.js';

// --- DOM ELEMENTS ---
const authorizeButton = document.getElementById('authorize_button');
const staffLoginSection = document.getElementById('staff-login-section');
const visitorSection = document.getElementById('visitor-section');
const searchButton = document.getElementById('search-button');
const registerButton = document.getElementById('register-button');
const resultsDiv = document.getElementById('results');
const firstNameInput = document.getElementById('firstname-input');
const lastNameInput = document.getElementById('lastname-input');
const emailInput = document.getElementById('email-input');
const phoneInput = document.getElementById('phone-input');
const searchBox = document.getElementById('search-box');

let tokenClient;
let gapiInited = false;
let gisInited = false;

// --- GAPI/GIS INITIALIZATION ---

// Assign to window object so the HTML can call it from the global scope
window.gapiLoaded = () => {
    gapi.load('client', initializeGapiClient);
};

async function initializeGapiClient() {
    await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
    gapiInited = true;
    maybeEnableButtons();
}

// Assign to window object so the HTML can call it from the global scope
window.gisLoaded = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '', // Will be defined dynamically on click
    });
    gisInited = true;
    maybeEnableButtons();
};

function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        authorizeButton.style.visibility = 'visible';
    }
}

// --- AUTHENTICATION ---
authorizeButton.onclick = () => handleAuthClick();

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        // On successful login, hide login section and show visitor kiosk
        staffLoginSection.style.display = 'none';
        visitorSection.style.display = 'block';
        // Attach main event listeners now that we are authenticated
        searchButton.addEventListener('click', searchVisitor);
        registerButton.addEventListener('click', registerAndCheckIn);
    };

    // If the user has not granted access, ask for consent.
    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        // Otherwise, just get a token silently.
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

// --- SPREADSHEET LOGIC ---

/**
 * Searches the spreadsheet for a visitor by email or phone.
 */
async function searchVisitor() {
    const searchTerm = searchBox.value.trim();
    if (!searchTerm) {
        resultsDiv.innerText = 'Please enter an email or phone number to search.';
        return;
    }
    resultsDiv.innerText = 'Searching...';

    try {
        // Fetch all data to search locally
        const response = await getSheetValues(`${SHEET_NAME}!A:E`); // Adjust range if more columns are used
        const rows = response.result.values;

        if (!rows || rows.length <= 1) { // Check for no data or only headers
            resultsDiv.innerText = 'No visitor data found in the sheet.';
            return;
        }
        
        // Dynamically find column indexes based on header names
        const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
        const emailIndex = headers.findIndex(h => h.includes('email'));
        const phoneIndex = headers.findIndex(h => h.includes('phone'));
        const firstNameIndex = headers.findIndex(h => h.includes('first'));
        const lastNameIndex = headers.findIndex(h => h.includes('last'));
        
        if (emailIndex === -1 || phoneIndex === -1) {
            resultsDiv.innerText = 'Could not find "Email" and "Phone" columns in the sheet.';
            return;
        }

        // Iterate through rows to find a match (skipping header row)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const email = (row[emailIndex] || '').trim();
            const phone = (row[phoneIndex] || '').trim();

            if (email.toLowerCase() === searchTerm.toLowerCase() || phone === searchTerm) {
                const visitorData = {
                    FirstName: row[firstNameIndex] || '',
                    LastName: row[lastNameIndex] || '',
                    Email: email,
                    Phone: phone
                };
                
                // Display result and a check-in button
                resultsDiv.innerHTML = `<p><strong>Visitor Found:</strong> ${visitorData.FirstName} ${visitorData.LastName}</p>`;
                const checkinButton = document.createElement('button');
                checkinButton.innerText = `Check-in ${visitorData.FirstName}`;
                checkinButton.onclick = () => checkInExistingVisitor(visitorData);
                resultsDiv.appendChild(checkinButton);
                return; // Stop after finding the first match
            }
        }
        resultsDiv.innerText = 'No visitor found with that email or phone number.';

    } catch (err) {
        console.error('Error during search:', err);
        resultsDiv.innerText = `Error: ${err.result?.error?.message || err.message}`;
    }
}

/**
 * Gathers data from the form to register a new visitor.
 */
async function registerAndCheckIn() {
    const dataObject = {
        FirstName: firstNameInput.value.trim(),
        LastName: lastNameInput.value.trim(),
        Email: emailInput.value.trim(),
        Phone: phoneInput.value.trim()
    };

    if (!dataObject.FirstName || !dataObject.LastName || !dataObject.Email) {
        resultsDiv.innerText = 'Please fill out at least First Name, Last Name, and Email.';
        return;
    }
    
    resultsDiv.innerText = 'Registering and checking in...';
    await appendVisitorData(dataObject);
}

/**
 * Checks in a visitor that was found via search.
 * @param {Object} dataObject The visitor's data.
 */
async function checkInExistingVisitor(dataObject) {
    resultsDiv.innerText = `Checking in ${dataObject.FirstName}...`;
    await appendVisitorData(dataObject);
}

/**
 * Prepares and appends a row of data to the Google Sheet.
 * @param {Object} dataObject The data for the new row.
 */
async function appendVisitorData(dataObject) {
    try {
        // Add a fresh timestamp to the data
        const dataWithTimestamp = {
            ...dataObject,
            Timestamp: new Date().toLocaleString()
        };

        // Use the service to prepare the row data according to the sheet's header order
        const rowData = await prepareRowData(SHEET_NAME, dataWithTimestamp, VISITOR_HEADER_MAP);
        
        // Append the prepared data
        await appendSheetValues(SHEET_NAME, [rowData]);

        resultsDiv.innerText = `Successfully checked in ${dataObject.FirstName} ${dataObject.LastName}!`;
        // Clear all input fields for the next visitor
        firstNameInput.value = '';
        lastNameInput.value = '';
        emailInput.value = '';
        phoneInput.value = '';
        searchBox.value = '';
    } catch (err) {
        console.error('Error appending data:', err);
        const errorMessage = err.result?.error?.message || err.message || 'An unknown error occurred.';
        resultsDiv.innerText = `Error checking in: ${errorMessage}`;
    }
}

