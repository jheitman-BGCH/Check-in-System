import { CLIENT_ID, DISCOVERY_DOC, SCOPES } from './authConfig.js';
import { SPREADSHEET_ID, VISITORS_SHEET_NAME, CHECKINS_SHEET_NAME, VISITOR_HEADER_MAP, CHECKINS_HEADER_MAP } from './state.js';
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
 * Listens for the custom 'google-scripts-ready' event from index.html
 * and then initializes the application. This ensures all external scripts are loaded first.
 */
window.addEventListener('google-scripts-ready', initializeApp);

function initializeApp() {
    gapi.load('client', async () => {
        await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
        
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // Will be defined dynamically on click
        });
        
        authorizeButton.style.visibility = 'visible'; // Enable the login button
        console.log("App initialized successfully.");
    });
}

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

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

// --- SPREADSHEET LOGIC ---

async function searchVisitor() {
    const searchTerm = searchBox.value.trim();
    if (!searchTerm) {
        resultsDiv.innerText = 'Please enter an email or phone number to search.';
        return;
    }
    resultsDiv.innerText = 'Searching...';

    try {
        const response = await getSheetValues(`${VISITORS_SHEET_NAME}!A:E`);
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
                    VisitorID: row[idIndex] || `ROW${i + 1}`,
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
        // Get headers ONCE at the beginning to find the ID column and avoid a second API call.
        const headerResponse = await getSheetValues(`${VISITORS_SHEET_NAME}!1:1`);
        if (!headerResponse.result.values || headerResponse.result.values.length === 0) {
            throw new Error(`Could not read headers from the '${VISITORS_SHEET_NAME}' sheet.`);
        }
        const headers = headerResponse.result.values[0];
        const idColumnIndex = headers.findIndex(h => String(h).toLowerCase().includes('id'));
        if (idColumnIndex === -1) {
            throw new Error('Cannot find a "VisitorID" or "ID" column in the Visitors sheet.');
        }
        const idColumnLetter = String.fromCharCode(65 + idColumnIndex);

        // Now, proceed with preparing and appending the data.
        const visitorRow = await prepareRowData(VISITORS_SHEET_NAME, visitorData, VISITOR_HEADER_MAP);
        const appendResponse = await appendSheetValues(VISITORS_SHEET_NAME, [visitorRow]);
        
        // Use a more robust regex to find the new row number from the response range.
        const updatedRange = appendResponse.result.updates.updatedRange;
        const match = updatedRange.match(/(\d+)/);
        if (!match) throw new Error("Could not determine new visitor's row number from range: " + updatedRange);
        
        const newVisitorRowNumber = match[1];
        const newVisitorId = `V${newVisitorRowNumber}`;
        visitorData.VisitorID = newVisitorId;
        
        // Update the VisitorID in the sheet using the pre-calculated column letter.
        const idCell = `${VISITORS_SHEET_NAME}!${idColumnLetter}${newVisitorRowNumber}`;
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: idCell,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[newVisitorId]] }
        });
        
        await checkIn(visitorData);

    } catch (err) {
        console.error('Error during registration:', err);
        const errorMessage = err.result?.error?.message || err.message || 'An unknown error occurred.';
        resultsDiv.innerText = `Registration Error: ${errorMessage}`;
    }
}

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

