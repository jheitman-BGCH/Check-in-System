import { CLIENT_ID, DISCOVERY_DOC, SCOPES } from './authConfig.js';
import { SPREADSHEET_ID, VISITORS_SHEET_NAME, CHECKINS_SHEET_NAME, VISITOR_HEADER_MAP, CHECKINS_HEADER_MAP } from './state.js';
import { getSheetValues, appendSheetValues, prepareRowData } from './sheetsService.js';

// --- BACKGROUND IMAGES ---
// This will hold the URLs of images fetched dynamically from your GitHub repository.
let backgroundImageUrls = [];

// --- GITHUB REPO CONFIG ---
// Inferred from your project structure. Change these if your username or repo name is different.
const GITHUB_USER = 'jheitman-bgch';
const GITHUB_REPO = 'check-in-system';
const IMAGE_FOLDER = 'bgimg'; // The folder in your repo containing the background images.


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
const showRegistrationButton = document.getElementById('show-registration-button');
const registrationForm = document.getElementById('registration-form');
const subscribeCheckbox = document.getElementById('subscribe-checkbox');


let tokenClient;
let tokenCheckInterval = null; // To hold the token refresh interval

// --- GAPI/GIS INITIALIZATION ---
window.addEventListener('google-scripts-ready', initializeApp);

/**
 * Fetches the list of background images from the specified GitHub repository folder.
 */
async function fetchBackgroundImages() {
    const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${IMAGE_FOLDER}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
        }
        const files = await response.json();
        // Filter out any non-file entries and map to the direct download URL.
        backgroundImageUrls = files
            .filter(file => file.type === 'file')
            .map(file => file.download_url);

        if (backgroundImageUrls.length > 0) {
            // Set the initial background image once the list is loaded.
            rotateBackgroundImage();
        } else {
            console.warn(`No images found in the '${IMAGE_FOLDER}' directory or the directory does not exist.`);
        }
    } catch (error) {
        console.error("Failed to fetch background images from GitHub:", error);
        // Optional: Set a fallback background color if images fail to load.
        document.body.style.backgroundColor = '#e0f7ff';
    }
}


/**
 * Sets a new, random background image from the fetched list.
 */
function rotateBackgroundImage() {
    if (backgroundImageUrls.length === 0) return; // Don't run if no images were loaded.

    // Select a random image from the array.
    const randomIndex = Math.floor(Math.random() * backgroundImageUrls.length);
    const imageUrl = backgroundImageUrls[randomIndex];
    
    // Apply a blue gradient overlay with adjusted opacity and the new image.
    document.body.style.backgroundImage = `
        linear-gradient(to right, rgba(0, 90, 156, 0.85), rgba(0, 123, 255, 0.4)),
        url('${imageUrl}')
    `;
}

/**
 * Initializes the Google API client and token client, then attempts a silent login.
 */
function initializeApp() {
    // Fetch the list of images from GitHub when the app starts.
    fetchBackgroundImages();

    gapi.load('client', async () => {
        await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
        
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // Will be defined dynamically
        });
        
        // Try to sign in silently when the app loads
        trySilentLogin();
    });
}

// --- AUTHENTICATION ---

/**
 * A shared callback handler for all token responses. It calculates and injects
 * the `expires_at` timestamp into the gapi token object for consistent time tracking.
 * @param {object} resp - The token response from Google Identity Services.
 * @returns {boolean} - True if the token was handled successfully, false otherwise.
 */
function handleTokenResponse(resp) {
    if (resp.error) {
        console.error('Google token error:', resp.error);
        return false;
    }

    // The gapi client library might not automatically create the 'expires_at' timestamp.
    // We'll calculate it manually from the 'expires_in' value (in seconds) and inject it.
    const token = gapi.client.getToken();
    if (token && resp.expires_in) {
        const expiresInMs = parseInt(resp.expires_in, 10) * 1000;
        token.expires_at = Date.now() + expiresInMs;
        gapi.client.setToken(token); // Ensure our modified token object is used.
        console.log("Token processed, session expires at:", new Date(token.expires_at).toLocaleTimeString());
    }
    
    return true;
}


/**
 * Handles the UI and logic changes upon a successful login or token refresh.
 */
function onLoginSuccess() {
    console.log("Authentication successful.");
    // Hide login section and show the main visitor kiosk interface
    staffLoginSection.style.display = 'none';
    visitorSection.style.display = 'block';
    
    // Attach main event listeners. Using .onclick ensures we don't add duplicate listeners on token refresh.
    searchButton.onclick = searchVisitor;
    registerButton.onclick = registerAndCheckIn;
    showRegistrationButton.onclick = () => {
        registrationForm.style.display = 'block';
        showRegistrationButton.style.display = 'none';
    };

    // Start or reset the timer to check the token periodically
    if (tokenCheckInterval) {
        clearInterval(tokenCheckInterval);
    }
    tokenCheckInterval = setInterval(checkAndRefreshToken, 30 * 1000); // Check every 30 seconds
}

/**
 * Attempts to sign in the user silently without requiring user interaction.
 */
function trySilentLogin() {
    console.log("Attempting silent login...");
    tokenClient.callback = (resp) => {
        if (handleTokenResponse(resp)) {
            console.log("Silent login successful.");
            onLoginSuccess();
        } else {
            console.warn('Silent login failed. User will need to log in manually.', resp.error.message);
            authorizeButton.style.visibility = 'visible';
        }
    };
    tokenClient.requestAccessToken({ prompt: 'none' });
}

/**
 * Handles the manual login button click for the first-time sign-in or re-authentication.
 */
function handleAuthClick() {
    console.log("Manual login initiated...");
    tokenClient.callback = (resp) => {
        if (handleTokenResponse(resp)) {
            onLoginSuccess();
        } else {
            resultsDiv.innerText = 'Authentication failed. Please try again.';
        }
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

/**
 * Performs a silent token refresh.
 */
function refreshToken() {
    console.log('Attempting to refresh token...');
    tokenClient.callback = (resp) => {
        if (handleTokenResponse(resp)) {
            console.log('Token refreshed successfully in the background.');
        } else {
            console.error('Failed to refresh token silently.');
            // Stop trying to refresh and revert to the login screen as the session is lost.
            clearInterval(tokenCheckInterval);
            staffLoginSection.style.display = 'block';
            visitorSection.style.display = 'none';
            authorizeButton.style.visibility = 'visible';
            resultsDiv.innerText = 'Your session has expired. Please log in again.';
        }
    };
    tokenClient.requestAccessToken({ prompt: 'none' });
}

/**
 * Periodically checks if the OAuth token is about to expire and refreshes it if necessary.
 */
function checkAndRefreshToken() {
    const token = gapi.client.getToken();
    if (!token) {
        console.log('No token found, user needs to log in.');
        clearInterval(tokenCheckInterval);
        staffLoginSection.style.display = 'block';
        visitorSection.style.display = 'none';
        authorizeButton.style.visibility = 'visible';
        resultsDiv.innerText = 'Your session has ended. Please log in again.';
        return;
    }

    // Now, token.expires_at should be a reliable number that we set ourselves.
    const expiresAt = token.expires_at;
    const now = Date.now();

    // Add a check to ensure expiresAt is a valid number before proceeding.
    if (typeof expiresAt !== 'number' || isNaN(expiresAt)) {
        console.error('Token expiration time is missing or invalid. Attempting to refresh.');
        refreshToken(); // If expiresAt is invalid, it's safer to just try refreshing.
        return;
    }

    const threeMinutesInMs = 3 * 60 * 1000;

    // Check if the token expires in the next 3 minutes or has already expired.
    if (expiresAt - now < threeMinutesInMs) {
        console.log('Token is expiring soon or has expired. Refreshing now...');
        refreshToken();
    } else {
        const minutesLeft = Math.round((expiresAt - now) / 60000);
        console.log(`Token is still valid for approximately ${minutesLeft} minutes.`);
    }
}

// Assign the click handler to the login button.
authorizeButton.onclick = handleAuthClick;


// --- SPREADSHEET LOGIC ---

async function searchVisitor() {
    // ... function content remains the same ...
    const searchTerm = searchBox.value.trim();
    if (!searchTerm) {
        resultsDiv.innerText = 'Please enter an email or phone number to search.';
        return;
    }
    resultsDiv.innerText = 'Searching...';
    registrationForm.style.display = 'none';
    showRegistrationButton.style.display = 'block';

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
        resultsDiv.innerText = 'Visitor not found. Please register below.';
        registrationForm.style.display = 'block';
        showRegistrationButton.style.display = 'none';

    } catch (err) {
        console.error('Error during search:', err);
        resultsDiv.innerText = `Search Error: ${err.result?.error?.message || err.message}`;
    }
}


function generateVisitorId() {
    // ... function content remains the same ...
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'V-';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function registerAndCheckIn() {
    // ... function content remains the same, checkIn() will handle the image change ...
    if (!firstNameInput.value.trim() || !lastNameInput.value.trim() || !emailInput.value.trim()) {
        resultsDiv.innerText = 'Please fill out at least First Name, Last Name, and Email.';
        return;
    }

    resultsDiv.innerText = 'Registering new visitor...';

    try {
        const response = await getSheetValues(`${VISITORS_SHEET_NAME}!A:A`);
        const existingIds = new Set(response.result.values ? response.result.values.flat() : []);
        
        let newVisitorId;
        do {
            newVisitorId = generateVisitorId();
        } while (existingIds.has(newVisitorId));

        const visitorData = {
            VisitorID: newVisitorId,
            FirstName: firstNameInput.value.trim(),
            LastName: lastNameInput.value.trim(),
            Email: emailInput.value.trim(),
            Phone: phoneInput.value.trim(),
            DateJoined: new Date().toLocaleString(),
            Subscribed: subscribeCheckbox.checked ? 'Yes' : 'No'
        };

        const visitorRow = await prepareRowData(VISITORS_SHEET_NAME, visitorData, VISITOR_HEADER_MAP);
        await appendSheetValues(VISITORS_SHEET_NAME, [visitorRow]);
        
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
        
        // --- CHANGE TRIGGER ---
        // Rotate the background image after a successful check-in.
        rotateBackgroundImage();

        // Clear all inputs and reset the UI to its initial state
        firstNameInput.value = '';
        lastNameInput.value = '';
        emailInput.value = '';
        phoneInput.value = '';
        searchBox.value = '';
        subscribeCheckbox.checked = false;
        registrationForm.style.display = 'none';
        showRegistrationButton.style.display = 'block';

    } catch (err) {
        console.error('Error during check-in:', err);
        resultsDiv.innerText = `Check-in Error: ${err.result?.error?.message || err.message}`;
    }
}

