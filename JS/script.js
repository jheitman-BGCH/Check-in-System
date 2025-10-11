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

/**
 * Generates a complex, random Visitor ID.
 * Format: V- followed by 8 random alphanumeric characters.
 * @returns {string} The new visitor ID.
 */
function generateVisitorId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'V-';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function registerAndCheckIn() {
    if (!firstNameInput.value.trim() || !lastNameInput.value.trim() || !emailInput.value.trim()) {
        resultsDiv.innerText = 'Please fill out at least First Name, Last Name, and Email.';
        return;
    }

    resultsDiv.innerText = 'Registering new visitor...';

    try {
        // 1. Fetch all existing visitor IDs to ensure the new one is unique.
        const response = await getSheetValues(`${VISITORS_SHEET_NAME}!A:A`); // Assuming ID is in column A
        const existingIds = new Set(response.result.values ? response.result.values.flat() : []);
        
        // 2. Generate a new ID and ensure it's unique.
        let newVisitorId;
        do {
            newVisitorId = generateVisitorId();
        } while (existingIds.has(newVisitorId));

        // 3. Create the full data object for the new visitor.
        const visitorData = {
            VisitorID: newVisitorId,
            FirstName: firstNameInput.value.trim(),
            LastName: lastNameInput.value.trim(),
            Email: emailInput.value.trim(),
            Phone: phoneInput.value.trim(),
            DateJoined: new Date().toLocaleString()
        };

        // 4. Prepare the row data and append it to the sheet.
        const visitorRow = await prepareRowData(VISITORS_SHEET_NAME, visitorData, VISITOR_HEADER_MAP);
        await appendSheetValues(VISITORS_SHEET_NAME, [visitorRow]);
        
        // 5. Proceed to check-in the new visitor.
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

