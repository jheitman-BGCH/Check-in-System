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
const searchContainer = document.getElementById('search-container');
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
const backToSearchButton = document.getElementById('back-to-search-button');
const inactivityModal = document.getElementById('inactivity-modal');
const countdownTimerSpan = document.getElementById('countdown-timer');
const stayButton = document.getElementById('stay-button');


let tokenClient;
let tokenRefreshTimeout = null; // To hold the token refresh timeout

// --- INACTIVITY TIMER STATE ---
let inactivityTimeout = null;
let countdownTimeout = null;
let countdownInterval = null;

// --- GAPI/GIS INITIALIZATION ---
// Expose the initializeApp function to the global scope so it can be called by the inline script in index.html
// This avoids a race condition where the 'google-scripts-ready' event might fire before this script has loaded.
window.initializeApp = initializeApp;

/**
 * Fetches the list of background images from the specified GitHub repository folder.
 */
async function fetchBackgroundImages() {
    console.log("DEBUG: BG: Starting fetchBackgroundImages...");
    const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${IMAGE_FOLDER}`;
    console.log(`DEBUG: BG: Fetching from API URL: ${apiUrl}`);
    try {
        const response = await fetch(apiUrl);
        console.log(`DEBUG: BG: GitHub API response status: ${response.status}`);
        if (!response.ok) {
            throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
        }
        const files = await response.json();
        console.log("DEBUG: BG: Received files from GitHub API:", files);

        // Filter out any non-file entries and map to the direct download URL.
        backgroundImageUrls = files
            .filter(file => file.type === 'file')
            .map(file => file.download_url);
        
        console.log("DEBUG: BG: Parsed image URLs:", backgroundImageUrls);

        if (backgroundImageUrls.length > 0) {
            // Set the initial background image once the list is loaded.
            console.log("DEBUG: BG: Found images. Calling rotateBackgroundImage().");
            rotateBackgroundImage();
        } else {
            console.warn(`DEBUG: BG: No images found in the '${IMAGE_FOLDER}' directory or the directory does not exist.`);
        }
    } catch (error) {
        console.error("DEBUG: BG: Failed to fetch background images from GitHub:", error);
        // Optional: Set a fallback background color if images fail to load.
        document.body.style.backgroundColor = '#e0f7ff';
    }
}


/**
 * Sets a new, random background image from the fetched list.
 * This version includes a fix to properly escape characters in the URL for CSS.
 */
function rotateBackgroundImage() {
    console.log("DEBUG: BG: rotateBackgroundImage() called.");
    if (backgroundImageUrls.length === 0) {
        console.warn("DEBUG: BG: Cannot rotate image, backgroundImageUrls array is empty.");
        return; // Don't run if no images were loaded.
    }

    // Select a random image from the array.
    const randomIndex = Math.floor(Math.random() * backgroundImageUrls.length);
    let imageUrl = backgroundImageUrls[randomIndex];
    console.log(`DEBUG: BG: Selected image URL: ${imageUrl}`);
    
    // FIX: Escape single quotes and other problematic characters for CSS.
    // This prevents a URL containing an apostrophe from breaking the `url('')` syntax.
    const escapedImageUrl = imageUrl.replace(/'/g, "\\'").replace(/"/g, '\\"');

    // Apply a blue gradient overlay with adjusted opacity and the new image.
    const styleString = `
        linear-gradient(to right, rgba(0, 90, 156, 0.85), rgba(0, 123, 255, 0.4)),
        url('${escapedImageUrl}')
    `;
    document.body.style.backgroundImage = styleString;
    console.log("DEBUG: BG: Applied new background image and gradient to body.");
}

/**
 * Initializes the Google API client and token client, then attempts a silent login.
 */
function initializeApp() {
    // DEBUG: Log when initializeApp is called
    console.log("DEBUG: 'google-scripts-ready' event fired. Running initializeApp().");
    
    // Fetch the list of images from GitHub when the app starts.
    fetchBackgroundImages();

    // DEBUG: Log before gapi.load
    console.log("DEBUG: Calling gapi.load('client')...");
    gapi.load('client', async () => {
        // DEBUG: Log inside gapi.load callback
        console.log("DEBUG: gapi.client loaded. Initializing client...");
        await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
        // DEBUG: Log after gapi.client.init
        console.log("DEBUG: gapi.client initialized.");
        
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // Will be defined dynamically
        });
        // DEBUG: Log after tokenClient init
        console.log("DEBUG: tokenClient initialized.");
        
        // Try to sign in silently when the app loads
        // DEBUG: Log before silent login attempt
        console.log("DEBUG: Attempting silent login sequence...");
        trySilentLogin();
    });
}

// --- AUTHENTICATION ---

/**
 * A shared callback handler for all token responses. It calculates the expiration
 * timestamp and schedules the next token refresh.
 * @param {object} resp - The token response from Google Identity Services.
 * @returns {boolean} - True if the token was handled successfully, false otherwise.
 */
function handleTokenResponse(resp) {
    if (resp.error) {
        console.error('Google token error:', resp.error);
        return false;
    }

    const token = gapi.client.getToken();
    if (token && resp.expires_in) {
        const expiresInMs = parseInt(resp.expires_in, 10) * 1000;
        token.expires_at = Date.now() + expiresInMs;
        gapi.client.setToken(token); // Ensure our modified token object is used.
        console.log("Token processed, session expires at:", new Date(token.expires_at).toLocaleTimeString());
        
        scheduleNextTokenRefresh(); // Schedule the next refresh.
    }
    
    return true;
}


/**
 * Handles the UI and logic changes upon a successful login.
 */
function onLoginSuccess() {
    console.log("Authentication successful.");
    // Hide login section and show the main visitor kiosk interface
    staffLoginSection.style.display = 'none';
    visitorSection.style.display = 'block';
    
    // Attach main event listeners.
    searchButton.onclick = searchVisitor;
    registerButton.onclick = registerAndCheckIn;
    showRegistrationButton.onclick = showRegistrationUI;
    backToSearchButton.onclick = showSearchUI;

    // Event listeners for resetting inactivity timer on form interaction
    const registrationInputs = [firstNameInput, lastNameInput, emailInput, phoneInput, subscribeCheckbox];
    registrationInputs.forEach(input => {
        input.addEventListener('input', resetInactivityTimer);
        input.addEventListener('click', resetInactivityTimer); // For checkbox
    });
    stayButton.onclick = hideInactivityModal;
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
            console.warn('Silent login failed. User will need to log in manually.', resp.error?.message);
            authorizeButton.style.visibility = 'visible';
        }
    };
    tokenClient.requestAccessToken({ prompt: 'none' });
}

/**
 * Handles the manual login button click.
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
 * Schedules the next token refresh to occur 3 minutes before the current token expires.
 */
function scheduleNextTokenRefresh() {
    if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
    }

    const token = gapi.client.getToken();
    if (!token || typeof token.expires_at !== 'number') {
        console.error("Cannot schedule token refresh: expiration time is missing.");
        return;
    }

    const threeMinutesInMs = 3 * 60 * 1000;
    const refreshTime = token.expires_at - threeMinutesInMs;
    const delay = refreshTime - Date.now();

    if (delay > 0) {
        tokenRefreshTimeout = setTimeout(refreshToken, delay);
        console.log(`Token refresh scheduled for: ${new Date(refreshTime).toLocaleTimeString()}`);
    } else {
        // If the token is already within the 3-minute window, refresh it now.
        console.warn("Token is already within its refresh window. Refreshing immediately.");
        refreshToken();
    }
}

/**
 * Performs a silent token refresh and schedules the next one upon success.
 */
function refreshToken() {
    console.log('Attempting to refresh token...');
    tokenClient.callback = (resp) => {
        if (handleTokenResponse(resp)) {
            console.log('Token refreshed successfully, next refresh has been scheduled.');
        } else {
            console.error('Failed to refresh token silently. Session lost.');
            if (tokenRefreshTimeout) {
                clearTimeout(tokenRefreshTimeout);
            }
            // Revert to the login screen
            staffLoginSection.style.display = 'block';
            visitorSection.style.display = 'none';
            authorizeButton.style.visibility = 'visible';
            resultsDiv.innerText = 'Your session has expired. Please log in again.';
        }
    };
    tokenClient.requestAccessToken({ prompt: 'none' });
}


// Assign the click handler to the login button.
authorizeButton.onclick = handleAuthClick;


// --- UI STATE MANAGEMENT & INACTIVITY TIMER ---

/**
 * Resets the UI to the initial search view.
 */
function showSearchUI() {
    searchContainer.style.display = 'block';
    showRegistrationButton.style.display = 'block';
    registrationForm.style.display = 'none';
    inactivityModal.style.display = 'none';

    clearTimeout(inactivityTimeout);
    clearTimeout(countdownTimeout);
    clearInterval(countdownInterval);

    searchBox.value = '';
    resultsDiv.innerHTML = '';
    firstNameInput.value = '';
    lastNameInput.value = '';
    emailInput.value = '';
    phoneInput.value = '';
    subscribeCheckbox.checked = false;
}

/**
 * Switches the UI to the new visitor registration view.
 */
function showRegistrationUI() {
    searchContainer.style.display = 'none';
    showRegistrationButton.style.display = 'none';
    resultsDiv.innerHTML = '';
    registrationForm.style.display = 'block';
    startInactivityTimer();
}

/**
 * Starts the main 60-second inactivity timer.
 */
function startInactivityTimer() {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(showInactivityModal, 60 * 1000); // 60 seconds
    console.log("Inactivity timer started (60s).");
}

/**
 * Resets the 60-second timer. Called on user interaction.
 */
function resetInactivityTimer() {
    startInactivityTimer();
}

/**
 * Shows the "Are you still there?" modal and starts the 10-second countdown.
 */
function showInactivityModal() {
    inactivityModal.style.display = 'flex';
    let secondsLeft = 10;
    countdownTimerSpan.textContent = secondsLeft;

    countdownInterval = setInterval(() => {
        secondsLeft--;
        countdownTimerSpan.textContent = secondsLeft;
        if (secondsLeft <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);

    countdownTimeout = setTimeout(() => {
        console.log("Inactivity timeout reached. Returning to search screen.");
        showSearchUI(); 
    }, 10 * 1000); // 10 seconds
}

/**
 * Hides the modal and resets the main inactivity timer.
 */
function hideInactivityModal() {
    inactivityModal.style.display = 'none';
    clearTimeout(countdownTimeout);
    clearInterval(countdownInterval);
    resetInactivityTimer();
    console.log("User confirmed presence. Inactivity timer reset.");
}


// --- SPREADSHEET LOGIC ---

async function searchVisitor() {
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
        // Use the helper function to switch views
        showRegistrationUI();

    } catch (err) {
        console.error('Error during search:', err);
        resultsDiv.innerText = `Search Error: ${err.result?.error?.message || err.message}`;
    }
}


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
    clearTimeout(inactivityTimeout); // Stop timer during processing

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
        resetInactivityTimer(); // Restart timer on failure
    }
}

async function checkIn(visitorData) {
    resultsDiv.innerText = `Checking in ${visitorData.FirstName}...`;
    // Stop all timers on successful interaction
    clearTimeout(inactivityTimeout);
    clearTimeout(countdownTimeout);
    clearInterval(countdownInterval);

    try {
        const checkinDataObject = {
            Timestamp: new Date().toLocaleString(),
            VisitorID: visitorData.VisitorID,
            FullName: `${visitorData.FirstName} ${visitorData.LastName}`.trim()
        };

        const checkinRow = await prepareRowData(CHECKINS_SHEET_NAME, checkinDataObject, CHECKINS_HEADER_MAP);
        await appendSheetValues(CHECKINS_SHEET_NAME, [checkinRow]);

        resultsDiv.innerText = `Successfully checked in ${visitorData.FirstName} ${visitorData.LastName}!`;
        
        rotateBackgroundImage();

        // Use the helper function to reset UI after a delay to show the message
        setTimeout(showSearchUI, 2000);

    } catch (err) {
        console.error('Error during check-in:', err);
        resultsDiv.innerText = `Check-in Error: ${err.result?.error?.message || err.message}`;
    }
}
