import { CLIENT_ID, DISCOVERY_DOC, SCOPES } from './authConfig.js';
import { SPREADSHEET_ID, VISITORS_SHEET_NAME, CHECKINS_SHEET_NAME, EVENTS_SHEET_NAME, VISITOR_HEADER_MAP, CHECKINS_HEADER_MAP, GUEST_HEADER_MAP } from './state.js';
import { getSheetValues, appendSheetValues, updateSheetValues, prepareRowData } from './sheetsService.js';

// --- BACKGROUND IMAGES ---
let backgroundImageUrls = [];
const GITHUB_USER = 'jheitman-bgch';
const GITHUB_REPO = 'check-in-system';
const IMAGE_FOLDER = 'bgimg';

// --- APPLICATION STATE ---
let tokenClient;
let tokenRefreshTimeout = null;
let inactivityTimeout = null;
let countdownTimeout = null;
let countdownInterval = null;
let activeEvents = [];
let selectedEvent = null;
let currentGuestData = null; // To hold guest data during the update flow
let currentMode = null; // 'event' or 'general'

// --- DOM ELEMENTS ---
const authorizeButton = document.getElementById('authorize_button');
const staffLoginSection = document.getElementById('staff-login-section');
const modeSelectionSection = document.getElementById('mode-selection-section');
const eventCheckinModeButton = document.getElementById('event-checkin-mode-button');
const generalVisitModeButton = document.getElementById('general-visit-mode-button');
const eventSelectionSection = document.getElementById('event-selection-section');
const eventListContainer = document.getElementById('event-list-container');
const backToModeSelectionButton = document.getElementById('back-to-mode-selection-button');
const visitorSection = document.getElementById('visitor-section');
const kioskTitle = document.getElementById('kiosk-title');
const searchContainer = document.getElementById('search-container');
const searchButton = document.getElementById('search-button');
const searchBox = document.getElementById('search-box');
const resultsDiv = document.getElementById('results');
const showRegistrationButton = document.getElementById('show-registration-button');
const registrationForm = document.getElementById('registration-form');
const firstNameInput = document.getElementById('firstname-input');
const lastNameInput = document.getElementById('lastname-input');
const emailInput = document.getElementById('email-input');
const phoneInput = document.getElementById('phone-input');
const subscribeCheckbox = document.getElementById('subscribe-checkbox');
const registerButton = document.getElementById('register-button');
const backToSearchButton = document.getElementById('back-to-search-button');
const updateGuestInfoSection = document.getElementById('update-guest-info-section');
const updateFirstNameInput = document.getElementById('update-firstname-input');
const updateLastNameInput = document.getElementById('update-lastname-input');
const updateEmailInput = document.getElementById('update-email-input');
const updatePhoneInput = document.getElementById('update-phone-input');
const updateAndCheckinButton = document.getElementById('update-and-checkin-button');
const backToEventSearchButton = document.getElementById('back-to-event-search-button');
const inactivityModal = document.getElementById('inactivity-modal');
const modalMessage = document.getElementById('modal-message');
const modalCountdownP = document.getElementById('modal-countdown-p');
const countdownTimerSpan = document.getElementById('countdown-timer');
const stayButton = document.getElementById('stay-button');
const fullscreenButton = document.getElementById('fullscreen-button');
const fullscreenIcon = document.getElementById('fullscreen-icon');
const exitFullscreenIcon = document.getElementById('exit-fullscreen-icon');


// --- GAPI/GIS INITIALIZATION ---
window.initializeApp = initializeApp;

/**
 * Initializes the Google API client, token client, and fetches startup data.
 */
function initializeApp() {
    console.log("DEBUG: 'google-scripts-ready' event fired. Running initializeApp().");
    fetchBackgroundImages();
    addEventListeners();
    gapi.load('client', async () => {
        await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // Will be defined dynamically
        });
        trySilentLogin();
    });
}

// --- EVENT LISTENERS ---
function addEventListeners() {
    if (fullscreenButton) {
        fullscreenButton.addEventListener('click', toggleFullScreen);
    }
    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
    document.addEventListener('mozfullscreenchange', updateFullscreenIcon);
    document.addEventListener('MSFullscreenChange', updateFullscreenIcon);
}

// --- UTILITY FUNCTIONS ---
/**
 * Converts a 1-based column number to its A1 notation letter equivalent.
 * e.g., 1 -> 'A', 27 -> 'AA'.
 * @param {number} columnNumber The 1-based column number.
 * @returns {string} The column letter.
 */
function numberToColumnLetter(columnNumber) {
    let columnName = '';
    let dividend = columnNumber;
    let modulo;

    while (dividend > 0) {
        modulo = (dividend - 1) % 26;
        columnName = String.fromCharCode(65 + modulo) + columnName;
        dividend = Math.floor((dividend - modulo) / 26);
    }
    return columnName;
}

/**
 * PATCH: Calculates the Levenshtein distance between two strings for fuzzy matching.
 * @param {string} a The first string.
 * @param {string} b The second string.
 * @returns {number} The edit distance between the two strings.
 */
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = a.charAt(j - 1) === b.charAt(i - 1) ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j - 1] + cost, // substitution
                matrix[i][j - 1] + 1,       // insertion
                matrix[i - 1][j] + 1        // deletion
            );
        }
    }
    return matrix[b.length][a.length];
}


// --- AUTHENTICATION ---

function handleTokenResponse(resp) {
    if (resp.error) {
        console.error('Google token error:', resp.error);
        return false;
    }
    const token = gapi.client.getToken();
    if (token && resp.expires_in) {
        const expiresInMs = parseInt(resp.expires_in, 10) * 1000;
        token.expires_at = Date.now() + expiresInMs;
        gapi.client.setToken(token);
        scheduleNextTokenRefresh();
    }
    return true;
}

async function onLoginSuccess() {
    console.log("Authentication successful.");
    staffLoginSection.style.display = 'none';
    await fetchActiveEvents();
    // If a mode was previously selected, return to it. Otherwise, show the mode selection screen.
    if (currentMode && selectedEvent) {
        console.log(`Returning to previous mode: ${currentMode}`);
        showKioskUI();
    } else {
        showModeSelection();
    }
}

function trySilentLogin() {
    tokenClient.callback = (resp) => {
        if (handleTokenResponse(resp)) {
            onLoginSuccess();
        } else {
            authorizeButton.style.visibility = 'visible';
        }
    };
    tokenClient.requestAccessToken({ prompt: 'none' });
}

function handleAuthClick() {
    tokenClient.callback = (resp) => {
        if (handleTokenResponse(resp)) {
            onLoginSuccess();
        } else {
            showModalMessage('Authentication failed. Please try again.');
        }
    };
    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}
authorizeButton.onclick = handleAuthClick;

function scheduleNextTokenRefresh() {
    // Logic to refresh token before expiry (condensed for brevity)
    if (tokenRefreshTimeout) clearTimeout(tokenRefreshTimeout);
    const token = gapi.client.getToken();
    if (!token || !token.expires_at) return;
    const delay = token.expires_at - Date.now() - (3 * 60 * 1000);
    if (delay > 0) {
        tokenRefreshTimeout = setTimeout(refreshToken, delay);
    } else {
        refreshToken();
    }
}

function refreshToken() {
    tokenClient.callback = (resp) => {
        if (!handleTokenResponse(resp)) {
            console.error('Session lost. Please log in again.');
            // This handles a true session loss (e.g. token revoked), requiring re-authentication.
            resetToLogin();
        }
    };
    tokenClient.requestAccessToken({ prompt: 'none' });
}


// --- UI STATE MANAGEMENT ---

function hideAllSections() {
    staffLoginSection.style.display = 'none';
    modeSelectionSection.style.display = 'none';
    eventSelectionSection.style.display = 'none';
    visitorSection.style.display = 'none';
    registrationForm.style.display = 'none';
    updateGuestInfoSection.style.display = 'none';
    inactivityModal.style.display = 'none';
}

function resetToLogin() {
    // Note: This function is for a complete session loss, not the inactivity timer.
    // It purposefully does NOT clear currentMode or selectedEvent, so a quick
    // re-login can resume the session. A full page refresh will clear them.
    hideAllSections();
    staffLoginSection.style.display = 'block';
    authorizeButton.style.visibility = 'visible';
    clearAllTimers();
}

function resetToModeSelection() {
    hideAllSections();
    modeSelectionSection.style.display = 'block';
    selectedEvent = null;
    currentGuestData = null;
    currentMode = null;
    resultsDiv.innerHTML = '';
    searchBox.value = '';
    clearAllTimers();
}

function showModeSelection() {
    hideAllSections();
    modeSelectionSection.style.display = 'block';
    eventCheckinModeButton.onclick = () => {
        currentMode = 'event';
        showEventSelection();
    };
    generalVisitModeButton.onclick = () => {
        currentMode = 'general';
        // FIX: Use EventTitle to align with the new data key in state.js
        selectedEvent = { EventTitle: 'General Visit', AllowWalkins: 'Yes' };
        showKioskUI();
    };
}

function showEventSelection() {
    hideAllSections();
    eventSelectionSection.style.display = 'block';
    eventListContainer.innerHTML = ''; // Clear previous event list

    if (activeEvents.length > 0) {
        activeEvents.forEach(event => {
            const button = document.createElement('button');
            button.className = 'event-button';
            // FIX: Use EventTitle to align with the new data key in state.js
            button.textContent = event.EventTitle;
            button.onclick = () => {
                selectedEvent = event;
                showKioskUI();
            };
            eventListContainer.appendChild(button);
        });
    } else {
        eventListContainer.innerHTML = '<p>No active events found.</p>';
    }

    backToModeSelectionButton.onclick = resetToModeSelection;
}

function showKioskUI() {
    hideAllSections();
    visitorSection.style.display = 'block';
    searchContainer.style.display = 'block';
    registrationForm.style.display = 'none';
    updateGuestInfoSection.style.display = 'none';
    resultsDiv.style.display = 'block'; // Make sure results are visible

    // FIX: Use EventTitle to align with the new data key in state.js
    kioskTitle.textContent = selectedEvent ? `${selectedEvent.EventTitle} Check-in` : 'General Visitor Check-in';
    showRegistrationButton.style.display = (selectedEvent && selectedEvent.AllowWalkins && selectedEvent.AllowWalkins.toLowerCase() === 'yes') ? 'block' : 'none';
    
    resultsDiv.innerHTML = '';
    searchBox.value = '';
    
    // Wire up buttons for the current context
    searchButton.onclick = searchGuest;
    searchBox.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchGuest();
        }
    });
    showRegistrationButton.onclick = showRegistrationUI;
    backToSearchButton.onclick = showKioskUI; // This now goes back to the search within the current event/mode
    
    // Ensure the inactivity timer is active on this screen.
    resetInactivityTimer();
}

function showRegistrationUI() {
    searchContainer.style.display = 'none';
    showRegistrationButton.style.display = 'none';
    resultsDiv.innerHTML = '';
    registrationForm.style.display = 'block';
    registerButton.onclick = registerWalkIn;
    startInactivityTimer();
}

function showUpdateGuestInfo(guestData) {
    currentGuestData = guestData; // Store the guest data temporarily
    searchContainer.style.display = 'none';
    resultsDiv.style.display = 'none';
    updateGuestInfoSection.style.display = 'block';

    updateFirstNameInput.value = guestData.FirstName;
    updateLastNameInput.value = guestData.LastName;
    
    updateEmailInput.value = guestData.Email || '';
    updatePhoneInput.value = guestData.Phone || '';

    // Highlight missing fields
    updateEmailInput.classList.toggle('missing-info', !guestData.Email);
    updatePhoneInput.classList.toggle('missing-info', !guestData.Phone);

    updateAndCheckinButton.onclick = handleUpdateAndCheckin;
    backToEventSearchButton.onclick = showKioskUI;
    startInactivityTimer();
}

// --- INACTIVITY TIMER ---

function clearAllTimers() {
    clearTimeout(inactivityTimeout);
    clearTimeout(countdownTimeout);
    clearInterval(countdownInterval);
}

function startInactivityTimer() {
    clearAllTimers();
    inactivityTimeout = setTimeout(showInactivityModal, 60 * 1000); // 60 seconds
}

function resetInactivityTimer() {
    startInactivityTimer();
}

function showInactivityModal() {
    modalMessage.textContent = "Are you still there?";
    modalCountdownP.style.display = 'block';
    stayButton.style.display = 'block';
    inactivityModal.style.display = 'flex';
    
    let secondsLeft = 10;
    countdownTimerSpan.textContent = secondsLeft;

    countdownInterval = setInterval(() => {
        secondsLeft--;
        countdownTimerSpan.textContent = secondsLeft;
        if (secondsLeft <= 0) clearInterval(countdownInterval);
    }, 1000);

    // CHANGE: On inactivity timeout, return to the clean kiosk screen for the
    // currently selected mode instead of logging out.
    countdownTimeout = setTimeout(showKioskUI, 10 * 1000);
}

function hideInactivityModal() {
    inactivityModal.style.display = 'none';
    clearAllTimers();
    resetInactivityTimer();
}
stayButton.onclick = hideInactivityModal;

function showModalMessage(message, duration = 3000) {
    modalMessage.textContent = message;
    modalCountdownP.style.display = 'none';
    stayButton.style.display = 'none';
    inactivityModal.style.display = 'flex';
    setTimeout(() => {
        inactivityModal.style.display = 'none';
    }, duration);
}

// --- SPREADSHEET LOGIC ---

async function fetchActiveEvents() {
    console.log("DEBUG: Starting fetchActiveEvents...");
    try {
        const response = await getSheetValues(`${EVENTS_SHEET_NAME}!A:D`);
        console.log("DEBUG: Raw response from getSheetValues:", response);

        const rows = response.result.values;
        console.log("DEBUG: Extracted rows from response:", rows);

        if (!rows || rows.length < 2) {
            console.log("DEBUG: No rows or insufficient rows found. Setting activeEvents to empty array.");
            activeEvents = [];
            return;
        }
        const headers = rows[0].map(h => h.trim().replace(/\s+/g, ''));
        console.log("DEBUG: Parsed headers:", headers);
        
        const allEvents = rows.slice(1).map(row => {
            const event = {};
            headers.forEach((header, index) => {
                // FIX: Use the header as the key directly, which now includes 'EventTitle'.
                event[header] = row[index];
            });
            return event;
        });
        console.log("DEBUG: All events mapped from rows (pre-filtering):", allEvents);

        // FIX: Changed 'Status' to 'IsActive' and checked for 'TRUE' to match the sheet.
        activeEvents = allEvents.filter(event => event.IsActive && event.IsActive.toLowerCase() === 'true');
        console.log("DEBUG: Filtered active events:", activeEvents);

    } catch (err) {
        console.error("Error fetching active events:", err);
        activeEvents = [];
        showModalMessage(`Error fetching events: ${err.result?.error?.message || err.message}`);
    }
}

/**
 * PATCH: This function has been completely rewritten to support fuzzy name search
 * and display multiple results for user selection.
 */
async function searchGuest() {
    const rawSearchTerm = searchBox.value.trim().toLowerCase();
    if (!rawSearchTerm) {
        resultsDiv.innerHTML = '<p>Please enter a name, email, or phone number.</p>';
        return;
    }
    resultsDiv.innerHTML = '<p>Searching...</p>';
    showRegistrationButton.style.display = 'none'; // Hide until search is complete

    const sheetToSearch = (currentMode === 'event' && selectedEvent) ? selectedEvent.GuestListSheetName : VISITORS_SHEET_NAME;

    if (!sheetToSearch) {
        resultsDiv.innerHTML = '<p>Error: Event sheet name is missing. Cannot perform search.</p>';
        return;
    }

    try {
        const response = await getSheetValues(`${sheetToSearch}!A:E`);
        const rows = response.result.values;
        
        if (!rows || rows.length <= 1) {
            displayNoResults();
            return;
        }
        
        const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
        const emailIndex = headers.findIndex(h => h.includes('email'));
        const phoneIndex = headers.findIndex(h => h.includes('phone'));
        const firstNameIndex = headers.findIndex(h => h.includes('first'));
        const lastNameIndex = headers.findIndex(h => h.includes('last'));
        const checkinTimeIndex = headers.findIndex(h => h.includes('check-in') || h.includes('checked in'));
        const visitorIdIndex = (currentMode === 'general') ? headers.findIndex(h => h.includes('id')) : -1;

        const matches = [];
        const cleanedSearchTerm = rawSearchTerm.replace(/\s+/g, ''); // Remove spaces for better matching

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const firstName = (row[firstNameIndex] || '').trim();
            const lastName = (row[lastNameIndex] || '').trim();
            const email = (row[emailIndex] || '').trim().toLowerCase();
            const phone = (row[phoneIndex] || '').trim().replace(/[^\d]/g, ''); // Keep only digits for phone
            const fullName = `${firstName} ${lastName}`.trim().toLowerCase();
            
            // Fuzzy matching logic
            const nameDistance = levenshteinDistance(rawSearchTerm, fullName);
            const emailDistance = levenshteinDistance(rawSearchTerm, email);
            
            // Check for match:
            // 1. Exact match on cleaned phone or email.
            // 2. Full name is very close to the search term (Levenshtein distance <= 2).
            // 3. A part of the name is very close (e.g., searching "john" for "john doe").
            const isMatch = (phone && phone.includes(cleanedSearchTerm)) ||
                            (email && email === rawSearchTerm) ||
                            (nameDistance <= 2) ||
                            (fullName.includes(rawSearchTerm));

            if (isMatch) {
                matches.push({
                    rowIndex: i + 1,
                    FirstName: firstName,
                    LastName: lastName,
                    Email: email,
                    Phone: row[phoneIndex] || '',
                    VisitorID: (currentMode === 'general' && visitorIdIndex > -1) ? row[visitorIdIndex] : null,
                    hasCheckedIn: !!row[checkinTimeIndex]
                });
            }
        }

        displaySearchResults(matches);

    } catch (err) {
        console.error('Error during search:', err);
        resultsDiv.innerHTML = `<p>Search Error: ${err.result?.error?.message || err.message}</p>`;
    }
}

/**
 * PATCH: New function to display search results. Handles multiple matches,
 * single matches, and no matches.
 * @param {Array<Object>} matches - An array of guest data objects that matched the search.
 */
function displaySearchResults(matches) {
    resultsDiv.innerHTML = ''; // Clear "Searching..."
    if (matches.length === 0) {
        displayNoResults();
        return;
    }

    if (matches.length > 1) {
        const p = document.createElement('p');
        p.textContent = 'We found a few people. Please select your name:';
        resultsDiv.appendChild(p);
    }
    
    matches.forEach(guestData => {
        if (guestData.hasCheckedIn) {
            const p = document.createElement('p');
            p.textContent = `${guestData.FirstName} ${guestData.LastName} has already checked in.`;
            resultsDiv.appendChild(p);
        } else {
            const button = document.createElement('button');
            button.className = 'result-button';
            button.textContent = `${guestData.FirstName} ${guestData.LastName} (${guestData.Email || guestData.Phone})`;
            button.onclick = () => handleGuestSelection(guestData);
            resultsDiv.appendChild(button);
        }
    });
}

function displayNoResults() {
    resultsDiv.innerHTML = '<p>Visitor not found. Please register below.</p>';
    if (selectedEvent && selectedEvent.AllowWalkins && selectedEvent.AllowWalkins.toLowerCase() === 'yes') {
        showRegistrationButton.style.display = 'block';
    }
}

/**
 * PATCH: New function to handle the logic after a guest is selected from the results.
 * @param {Object} guestData - The data for the selected guest.
 */
function handleGuestSelection(guestData) {
    if (currentMode === 'general') {
        generalCheckIn(guestData);
    } else { // Event Mode
        // If critical info is missing, prompt for an update.
        if (!guestData.Email || !guestData.Phone) {
            showUpdateGuestInfo(guestData);
        } else {
            // Otherwise, confirm and check-in.
            resultsDiv.innerHTML = `<p><strong>Welcome, ${guestData.FirstName} ${guestData.LastName}!</strong></p>`;
            const checkinButton = document.createElement('button');
            checkinButton.innerText = `Confirm & Check-in`;
            checkinButton.onclick = () => checkInGuestAndSync(guestData, selectedEvent);
            resultsDiv.appendChild(checkinButton);
        }
    }
}


function handleUpdateAndCheckin() {
    const updatedGuestData = { ...currentGuestData }; // Copy original data
    updatedGuestData.Email = updateEmailInput.value.trim();
    updatedGuestData.Phone = updatePhoneInput.value.trim();

    if (!updatedGuestData.Email) {
        showModalMessage('Email is required to check-in.');
        return;
    }
    checkInGuestAndSync(updatedGuestData, selectedEvent);
}

async function registerWalkIn() {
    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();
    const email = emailInput.value.trim();
    const phone = phoneInput.value.trim();

    if (!firstName || !lastName || !email) {
        showModalMessage('First Name, Last Name, and Email are required.', 2500);
        return;
    }

    // PATCH: Before registering, check if a visitor with this email already exists in "general" mode.
    if (currentMode === 'general') {
        resultsDiv.innerText = 'Checking for existing visitor...';
        try {
            const response = await getSheetValues(`${VISITORS_SHEET_NAME}!A:E`); // Check against the main Visitors sheet
            const rows = response.result.values;
            if (rows && rows.length > 1) {
                const headers = rows[0].map(h => h.toLowerCase());
                const emailIndex = headers.indexOf('email');
                if (emailIndex > -1) {
                    const existingVisitor = rows.slice(1).find(row => row[emailIndex] && row[emailIndex].toLowerCase() === email.toLowerCase());
                    if (existingVisitor) {
                        // If the visitor exists, show a message and stop the registration.
                        showModalMessage('A visitor with this email already exists. Please go back and search to check in.', 4000);
                        resultsDiv.innerText = ''; // Clear the "checking..." message
                        return; // Stop the function here.
                    }
                }
            }
        } catch (err) {
            console.error('Error checking for existing visitor:', err);
            resultsDiv.innerText = `Error: ${err.result?.error?.message || err.message}`;
            startInactivityTimer();
            return;
        }
    }

    const walkinData = {
        isWalkIn: true, // Flag to indicate a new guest
        FirstName: firstName,
        LastName: lastName,
        Email: email,
        Phone: phone,
        DateJoined: new Date().toLocaleString(),
        Subscribed: subscribeCheckbox.checked ? 'Yes' : 'No'
    };
    
    if(currentMode === 'general'){
        // If we're here, it's a new visitor, so we can proceed.
        generalRegisterAndCheckIn(walkinData);
    } else {
        // Event check-ins will handle de-duplication automatically via findOrCreateVisitor.
        checkInGuestAndSync(walkinData, selectedEvent);
    }
}

async function generalRegisterAndCheckIn(walkinData) {
    resultsDiv.innerText = 'Registering new visitor...';
    clearAllTimers();
    try {
        const newVisitorId = await findOrCreateVisitor(walkinData);
        const visitorDataForCheckin = {
            ...walkinData,
            VisitorID: newVisitorId
        };
        await generalCheckIn(visitorDataForCheckin);
    } catch(err) {
        console.error('Error during general registration:', err);
        resultsDiv.innerText = `Registration Error: ${err.result?.error?.message || err.message}`;
        startInactivityTimer();
    }
}


async function generalCheckIn(visitorData) {
    resultsDiv.innerText = `Checking in ${visitorData.FirstName}...`;
    clearAllTimers();
    try {
        const checkinDataObject = {
            Timestamp: new Date().toLocaleString(),
            VisitorID: visitorData.VisitorID,
            FullName: `${visitorData.FirstName} ${visitorData.LastName}`.trim(),
            // FIX: Use EventTitle to align with the new data key in state.js
            EventTitle: 'General Visit'
        };
        const checkinRow = await prepareRowData(CHECKINS_SHEET_NAME, checkinDataObject, CHECKINS_HEADER_MAP);
        await appendSheetValues(CHECKINS_SHEET_NAME, [checkinRow]);
        resultsDiv.innerText = `Successfully checked in ${visitorData.FirstName}!`;
        rotateBackgroundImage();
        setTimeout(showKioskUI, 2000);
    } catch (err) {
        console.error('Error during general check-in:', err);
        resultsDiv.innerText = `Check-in Error: ${err.result?.error?.message || err.message}`;
    }
}

/**
 * NEW: Checks the central 'Checkins' log to see if a visitor has already checked in for a specific event.
 * This is the definitive check to prevent duplicates.
 * @param {string} visitorId The unique ID of the visitor.
 * @param {string} eventTitle The title of the event.
 * @returns {Promise<boolean>} A promise that resolves to true if already checked in, false otherwise.
 */
async function checkIfAlreadyCheckedIn(visitorId, eventTitle) {
    console.log(`DEBUG: Checking if VisitorID ${visitorId} has already checked in for event "${eventTitle}"`);
    try {
        const response = await getSheetValues(`${CHECKINS_SHEET_NAME}!A:D`); // Check first 4 columns
        const rows = response.result.values;

        if (!rows || rows.length < 2) {
            console.log("DEBUG: Checkins sheet is empty or has no data.");
            return false; // No check-ins yet, so can't be a duplicate.
        }

        const headers = rows[0].map(h => String(h || '').trim().replace(/\s+/g, '').toLowerCase());
        const visitorIdIndex = headers.findIndex(h => h.includes('visitorid'));
        const eventTitleIndex = headers.findIndex(h => h.includes('eventtitle'));

        if (visitorIdIndex === -1 || eventTitleIndex === -1) {
            console.error("DEBUG: Could not find 'VisitorID' or 'EventTitle' headers in Checkins sheet. Allowing check-in to proceed.");
            return false;
        }
        
        const normalizedEventTitle = eventTitle.trim().toLowerCase();

        // Iterate through all existing check-in records to find a match.
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const recordVisitorId = row[visitorIdIndex] ? String(row[visitorIdIndex]).trim() : '';
            const recordEventTitle = row[eventTitleIndex] ? String(row[eventTitleIndex]).trim().toLowerCase() : '';
            
            if (recordVisitorId === visitorId && recordEventTitle === normalizedEventTitle) {
                console.log("DEBUG: Match found. Visitor has already checked in.");
                return true; // Found a matching check-in.
            }
        }
        
        console.log("DEBUG: No matching check-in found.");
        return false; // No match found after checking all records.
    } catch (err) {
        console.error("Error in checkIfAlreadyCheckedIn:", err);
        showModalMessage('Could not verify previous check-in status. Please proceed with caution.');
        return false; // Allow check-in to proceed if the check fails, to avoid blocking users.
    }
}


async function checkInGuestAndSync(guestData, eventDetails) {
    resultsDiv.innerHTML = `<p>Checking in ${guestData.FirstName}...</p>`;
    resultsDiv.style.display = 'block';
    updateGuestInfoSection.style.display = 'none';
    registrationForm.style.display = 'none';
    searchContainer.style.display = 'block';
    clearAllTimers();

    try {
        // Step 1: Find or Create Visitor Record to get a standardized VisitorID.
        const visitorId = await findOrCreateVisitor(guestData);

        // Step 2: NEW - Perform the definitive check against the central log.
        const eventTitle = eventDetails.EventTitle;
        const alreadyCheckedIn = await checkIfAlreadyCheckedIn(visitorId, eventTitle);
        if (alreadyCheckedIn) {
            resultsDiv.innerText = `${guestData.FirstName} ${guestData.LastName} has already checked in for this event.`;
            setTimeout(showKioskUI, 3000); // Return to the main kiosk screen.
            return; // Stop the function here to prevent a duplicate check-in.
        }

        // Step 3: Update or Append guest record to the specific Event Sheet.
        const timestamp = new Date().toLocaleString();
        guestData.CheckinTimestamp = timestamp;

        if (guestData.isWalkIn) {
            const guestRow = await prepareRowData(eventDetails.GuestListSheetName, guestData, GUEST_HEADER_MAP);
            await appendSheetValues(eventDetails.GuestListSheetName, [guestRow]);
        } else {
            const updatedGuestRow = await prepareRowData(eventDetails.GuestListSheetName, guestData, GUEST_HEADER_MAP);
            
            const endColumn = numberToColumnLetter(updatedGuestRow.length);
            if (!endColumn) {
                throw new Error("Could not determine the sheet's column range because prepared data is empty.");
            }
            const range = `${eventDetails.GuestListSheetName}!A${guestData.rowIndex}:${endColumn}${guestData.rowIndex}`;
            console.log(`DEBUG: Dynamically determined update range: ${range}`);
            
            await updateSheetValues(range, [updatedGuestRow]);
        }
        
        // Step 4: Log the successful check-in to the main Checkins Sheet.
        const checkinLogData = {
            Timestamp: timestamp,
            VisitorID: visitorId,
            FullName: `${guestData.FirstName} ${guestData.LastName}`.trim(),
            EventTitle: eventTitle
        };
        const checkinRow = await prepareRowData(CHECKINS_SHEET_NAME, checkinLogData, CHECKINS_HEADER_MAP);
        await appendSheetValues(CHECKINS_SHEET_NAME, [checkinRow]);
        
        resultsDiv.innerText = `Successfully checked in ${guestData.FirstName} for ${eventTitle}!`;
        rotateBackgroundImage();
        setTimeout(showKioskUI, 2500);

    } catch (err) {
        console.error('Error in checkInGuestAndSync:', err);
        resultsDiv.innerText = `Sync Error: ${err.result?.error?.message || err.message}`;
        startInactivityTimer();
    }
}

async function findOrCreateVisitor(guestData) {
    // Search the main Visitors sheet by email.
    const response = await getSheetValues(`${VISITORS_SHEET_NAME}!A:E`);
    const rows = response.result.values;
    if (rows && rows.length > 1) {
        // FIX: Made header searching more robust to prevent duplicate visitor creation.
        // It now finds columns if the header *includes* the term (e.g., "Email Address" will match "email").
        const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
        const emailIndex = headers.findIndex(h => h.includes('email'));
        const idIndex = headers.findIndex(h => h.includes('visitor id') || h.includes('visitorid'));


        if (emailIndex > -1 && idIndex > -1) {
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][emailIndex] && guestData.Email && rows[i][emailIndex].toLowerCase() === guestData.Email.toLowerCase()) {
                    console.log("Found existing visitor:", rows[i][idIndex]);
                    return rows[i][idIndex]; // Return existing VisitorID
                }
            }
        }
    }

    // If not found, create a new visitor.
    console.log("Visitor not found, creating new record.");
    const newVisitorId = await generateUniqueVisitorId();
    const newVisitorData = {
        VisitorID: newVisitorId,
        FirstName: guestData.FirstName,
        LastName: guestData.LastName,
        Email: guestData.Email,
        Phone: guestData.Phone,
        DateJoined: guestData.DateJoined || new Date().toLocaleString(),
        Subscribed: guestData.Subscribed || 'No'
    };
    const visitorRow = await prepareRowData(VISITORS_SHEET_NAME, newVisitorData, VISITOR_HEADER_MAP);
    await appendSheetValues(VISITORS_SHEET_NAME, [visitorRow]);
    return newVisitorId;
}

async function generateUniqueVisitorId() {
    let newId;
    let isUnique = false;
    const response = await getSheetValues(`${VISITORS_SHEET_NAME}!A:A`);
    const existingIds = new Set(response.result.values ? response.result.values.flat() : []);
    
    while (!isUnique) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        newId = 'V-';
        for (let i = 0; i < 8; i++) {
            newId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (!existingIds.has(newId)) {
            isUnique = true;
        }
    }
    return newId;
}

// --- FULLSCREEN LOGIC ---
function toggleFullScreen() {
    // Check if we are currently in fullscreen
    if (!isFullScreen()) {
        // If not, find the correct method to request fullscreen
        const element = document.documentElement; // Target the whole page
        const requestMethod = element.requestFullscreen || element.webkitRequestFullscreen || element.mozRequestFullScreen || element.msRequestFullscreen;
        
        if (requestMethod) {
            // Call the found method to enter fullscreen
            requestMethod.call(element);
        } else {
            // Fallback for browsers that do not support the API
            console.warn("Fullscreen API is not supported by this browser.");
            alert("Fullscreen mode is not supported on this device.");
        }
    } else {
        // If we are in fullscreen, find the correct method to exit
        const exitMethod = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        
        if (exitMethod) {
            // Call the found method to exit fullscreen
            exitMethod.call(document);
        }
    }
}

function isFullScreen() {
    // Check for the fullscreen element using all vendor prefixes
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}

function updateFullscreenIcon() {
    if (isFullScreen()) {
        fullscreenIcon.style.display = 'none';
        exitFullscreenIcon.style.display = 'block';
    } else {
        fullscreenIcon.style.display = 'block';
        exitFullscreenIcon.style.display = 'none';
    }
}


// --- BACKGROUND IMAGE ROTATOR ---
async function fetchBackgroundImages() {
    const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${IMAGE_FOLDER}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`GitHub API Error: ${response.status}`);
        const files = await response.json();
        backgroundImageUrls = files.filter(f => f.type === 'file').map(f => f.download_url);
        if (backgroundImageUrls.length > 0) rotateBackgroundImage();
    } catch (error) {
        console.error("Failed to fetch background images:", error);
    }
}

function rotateBackgroundImage() {
    if (backgroundImageUrls.length === 0) return;
    const imageUrl = backgroundImageUrls[Math.floor(Math.random() * backgroundImageUrls.length)];
    const escapedImageUrl = imageUrl.replace(/'/g, "\\'").replace(/"/g, '\\"');
    document.body.style.backgroundImage = `linear-gradient(to right, rgba(0, 90, 156, 0.85), rgba(0, 123, 255, 0.4)), url('${escapedImageUrl}')`;
}
