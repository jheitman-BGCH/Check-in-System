// js/script.js
import { CLIENT_ID, DISCOVERY_DOC, SCOPES } from './authConfig.js';
import { VISITORS_SHEET_NAME, CHECKINS_SHEET_NAME, VISITOR_HEADER_MAP, CHECKINS_HEADER_MAP } from './state.js';
import { getSheetValues, appendSheetValues, prepareRowData } from './sheetsService.js';

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

// --- GAPI/GIS INITIALIZATION ---

/**
 * Initializes the Google API client and the Google Identity Services client.
 * This function is called after the main Google API scripts have loaded.
 * It uses Promises to ensure both libraries are ready before enabling the app.
 */
function initializeApp() {
    const gapiPromise = new Promise((resolve) => gapi.load('client', resolve));
    const gisPromise = new Promise((resolve) => {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // Will be defined dynamically on click
        });
        resolve();
    });

    Promise.all([gapiPromise, gisPromise])
        .then(async () => {
            // Both libraries are loaded. Now initialize the GAPI client.
            await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
            authorizeButton.style.visibility = 'visible'; // Enable the login button
            console.log("App initialized successfully.");
        })
        .catch(err => {
            console.error("Error during app initialization:", err);
            staffLoginSection.innerHTML = '<p>Error: Could not initialize Google services. Please refresh the page.</p>';
        });
}

// Assign the initializer to the window so it can be called by the Google script loader.
window.onGoogleScriptsLoaded = initializeApp;

// --- AUTHENTICATION ---
authorizeButton.onclick = () => handleAuthClick();

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error) {
            console.error('Google token error:', resp.error);
            resultsDiv.innerText = 'Authentication failed. Please try again.';
            return;
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
 * Searches the 'Visitors' sheet for a record by email or phone.
 */
async function searchVisitor() {
    const searchTerm = searchBox.value.trim();
    if (!searchTerm) {
        resultsDiv.innerText = 'Please enter an email or phone number to search.';
        return;
    }
    resultsDiv.innerText = 'Searching...';

    try {
        const response = await getSheetValues(`${VISITORS_SHEET_NAME}!A:E`); // Assuming data is within first 5 columns
        const rows = response.result.values;

        if (!rows || rows.length <= 1) {
            resultsDiv.innerText = 'No visitor data found.';
            return;
        }

        const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
        const idIndex = headers.findIndex(h => h.includes('id'));
        const emailIndex = headers.findIndex(h => h.includes('email'));
        const phoneIndex = headers.findIndex(h => h.includes('phone'));
        const firstNameIndex = headers.findIndex(h => h.includes('first'));
        const lastNameIndex = headers.findIndex(h => h.includes('last'));

        if (emailIndex === -1 && phoneIndex === -1) {
            resultsDiv.innerText = 'Could not find Email or Phone columns in the Visitors sheet.';
            return;
        }

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const email = (row[emailIndex] || '').trim();
            const phone = (row[phoneIndex] || '').trim();

            if (email.toLowerCase() === searchTerm.toLowerCase() || (phone && phone === searchTerm)) {
                const visitorData = {
                    VisitorID: row[idIndex] || `ROW${i + 1}`, // Fallback to row number if ID is missing
                    FirstName: row[firstNameIndex] || '',
                    LastName: row[lastNameIndex] || '',
                    Email: email,
                    Phone: phone
                };

                resultsDiv.innerHTML = `<p><strong>Visitor Found:</strong> ${visitorData.FirstName} ${visitorData.LastName}</p>`;
                const checkinButton = document.createElement('button');
                checkinButton.innerText = `Check-in ${visitorData.FirstName}`;
                checkinButton.onclick = () => checkIn(visitorData);
                resultsDiv.appendChild(checkinButton);
                return;
            }
        }
        resultsDiv.innerText = 'No visitor found with that email or phone number.';

    } catch (err) {
        console.error('Error during search:', err);
        resultsDiv.innerText = `Search Error: ${err.result?.error?.message || err.message}`;
    }
}

/**
 * Gathers data from the form, registers a new visitor, and then checks them in.
 */
async function registerAndCheckIn() {
    const visitorData = {
        FirstName: firstNameInput.value.trim(),
        LastName: lastNameInput.value.trim(),
        Email: emailInput.value.trim(),
        Phone: phoneInput.value.trim()
    };

    if (!visitorData.FirstName || !visitorData.LastName || !visitorData.Email) {
        resultsDiv.innerText = 'Please fill out at least First Name, Last Name, and Email.';
        return;
    }

    resultsDiv.innerText = 'Registering new visitor...';

    try {
        // 1. Prepare and append data to the 'Visitors' sheet
        const visitorRow = await prepareRowData(VISITORS_SHEET_NAME, visitorData, VISITOR_HEADER_MAP);
        const appendResponse = await appendSheetValues(VISITORS_SHEET_NAME, [visitorRow]);
        
        // 2. Extract the row number from the response to use as the VisitorID
        const updatedRange = appendResponse.result.updates.updatedRange;
        const match = updatedRange.match(/!A(\d+):/);
        if (!match) throw new Error("Could not determine new visitor's row number for ID.");
        const newVisitorId = match[1];

        // 3. Update the 'Visitors' sheet with the new ID
        const idCell = `${VISITORS_SHEET_NAME}!A${newVisitorId}`;
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: gapi.client.sheets.SPREADSHEET_ID, // This needs to be set properly
            range: idCell,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[`V${newVisitorId}`]] }
        });
        
        visitorData.VisitorID = `V${newVisitorId}`; // Add the new ID to our object
        
        // 4. Now, check the new visitor in
        await checkIn(visitorData);

    } catch (err) {
        console.error('Error during registration:', err);
        resultsDiv.innerText = `Registration Error: ${err.result?.error?.message || err.message}`;
    }
}

/**
 * Logs a check-in for a visitor (both existing and new).
 * @param {Object} visitorData The visitor's data, must include VisitorID, FirstName, and LastName.
 */
async function checkIn(visitorData) {
    resultsDiv.innerText = `Checking in ${visitorData.FirstName}...`;
    try {
        const checkinDataObject = {
            Timestamp: new Date().toLocaleString(),
            VisitorID: visitorData.VisitorID,
            FullName: `${visitorData.FirstName} ${visitorData.LastName}`.trim()
        };

        const checkinRow = await prepareRowData(CHECKINS_SHEET_NAME, checkinDataObject, CHECKINS_HEADER_MAP);
        await appendSheetValues(CHECKINS_SHEET_NAME, [checkinRow]);

        resultsDiv.innerText = `Successfully checked in ${visitorData.FirstName} ${visitorData.LastName}!`;
        // Clear all input fields for the next visitor
        firstNameInput.value = '';
        lastNameInput.value = '';
        emailInput.value = '';
        phoneInput.value = '';
        searchBox.value = '';

    } catch (err) {
        console.error('Error during check-in:', err);
        resultsDiv.innerText = `Check-in Error: ${err.result?.error?.message || err.message}`;
    }
}
