// --- CONFIGURATION ---
const CLIENT_ID = "865792564925-q134653h21j87d2gj79makt4fm46cltg.apps.googleusercontent.com";
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // <-- IMPORTANT: Update this!

// --- DOM ELEMENTS ---
const authorizeButton = document.getElementById('authorize_button');
const staffLoginSection = document.getElementById('staff-login-section');
const visitorSection = document.getElementById('visitor-section');

let tokenClient;
let gapiInited = false;
let gisInited = false;

// --- GAPI/GIS INITIALIZATION ---

function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({
        discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInited = true;
    maybeEnableButtons();
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '', // defined later
    });
    gisInited = true;
    maybeEnableButtons();
}

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
        // Successful login
        staffLoginSection.style.display = 'none';
        visitorSection.style.display = 'block';
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}


// --- SPREADSHEET LOGIC ---
// You will add the functions to search, register, and check-in visitors here
// in the next step of our plan.