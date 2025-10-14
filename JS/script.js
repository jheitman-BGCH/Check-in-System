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


// --- GAPI/GIS INITIALIZATION ---
window.initializeApp = initializeApp;

/**
 * Initializes the Google API client, token client, and fetches startup data.
 */
function initializeApp() {
    console.log("DEBUG: 'google-scripts-ready' event fired. Running initializeApp().");
    fetchBackgroundImages();
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
    showModeSelection();
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
        selectedEvent = { EventName: 'General Visit', AllowWalkins: 'Yes' }; // Mock event for general visits
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
            button.textContent = event.EventName;
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

    kioskTitle.textContent = selectedEvent ? `${selectedEvent.EventName} Check-in` : 'General Visitor Check-in';
    showRegistrationButton.style.display = (selectedEvent && selectedEvent.AllowWalkins && selectedEvent.AllowWalkins.toLowerCase() === 'yes') ? 'block' : 'none';
    
    resultsDiv.innerHTML = '';
    searchBox.value = '';
    
    // Wire up buttons for the current context
    searchButton.onclick = searchGuest;
    showRegistrationButton.onclick = showRegistrationUI;
    backToSearchButton.onclick = showKioskUI; // This now goes back to the search within the current event/mode
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

    countdownTimeout = setTimeout(resetToModeSelection, 10 * 1000); // 10 seconds
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

async function searchGuest() {
    const searchTerm = searchBox.value.trim().toLowerCase();
    if (!searchTerm) {
        resultsDiv.innerText = 'Please enter an email or phone number.';
        return;
    }
    resultsDiv.innerText = 'Searching...';
    console.log(`DEBUG: Searching for '${searchTerm}' in mode '${currentMode}'.`);

    // Determine which sheet and logic to use based on mode
    const sheetToSearch = (currentMode === 'event' && selectedEvent) ? selectedEvent.GuestListSheetName : VISITORS_SHEET_NAME;
    console.log(`DEBUG: Determined sheet to search: '${sheetToSearch}'.`);

    if (!sheetToSearch) {
        console.error("DEBUG: searchGuest failed because sheetToSearch is undefined. selectedEvent:", selectedEvent);
        resultsDiv.innerText = 'Error: Event sheet name is missing. Cannot perform search.';
        return;
    }

    try {
        const response = await getSheetValues(`${sheetToSearch}!A:E`);
        console.log(`DEBUG: Raw response from getSheetValues for sheet '${sheetToSearch}':`, response);
        const rows = response.result.values;
        console.log(`DEBUG: Extracted rows for sheet '${sheetToSearch}':`, rows);
        
        if (!rows || rows.length <= 1) {
            resultsDiv.innerText = 'No guests found.';
            if (currentMode === 'event' && selectedEvent.AllowWalkins.toLowerCase() === 'yes') {
                showRegistrationButton.style.display = 'block';
            }
            return;
        }
        
        const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
        const emailIndex = headers.findIndex(h => h.includes('email'));
        const phoneIndex = headers.findIndex(h => h.includes('phone'));
        const firstNameIndex = headers.findIndex(h => h.includes('first'));
        const lastNameIndex = headers.findIndex(h => h.includes('last'));
        const checkinTimeIndex = headers.findIndex(h => h.includes('check-in') || h.includes('checked in'));
        const visitorIdIndex = (currentMode === 'general') ? headers.findIndex(h => h.includes('id')) : -1;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const email = (row[emailIndex] || '').trim().toLowerCase();
            const phone = (row[phoneIndex] || '').trim();

            if (email === searchTerm || phone === searchTerm) {
                if (row[checkinTimeIndex]) {
                    resultsDiv.innerText = `${row[firstNameIndex]} ${row[lastNameIndex]} has already checked in.`;
                    return;
                }

                const guestData = {
                    rowIndex: i + 1, // Store the 1-based row index for updates
                    FirstName: row[firstNameIndex] || '',
                    LastName: row[lastNameIndex] || '',
                    Email: email,
                    Phone: phone
                };
                
                if (currentMode === 'general') {
                    guestData.VisitorID = row[visitorIdIndex] || '';
                    resultsDiv.innerHTML = `<p><strong>Visitor Found:</strong> ${guestData.FirstName} ${guestData.LastName}</p>`;
                    const checkinButton = document.createElement('button');
                    checkinButton.innerText = `Check-in ${guestData.FirstName}`;
                    checkinButton.onclick = () => generalCheckIn(guestData);
                    resultsDiv.appendChild(checkinButton);
                } else { // Event Mode
                    if (!guestData.Email || !guestData.Phone) {
                        showUpdateGuestInfo(guestData);
                    } else {
                        resultsDiv.innerHTML = `<p><strong>Guest Found:</strong> ${guestData.FirstName} ${guestData.LastName}</p>`;
                        const checkinButton = document.createElement('button');
                        checkinButton.innerText = `Check-in ${guestData.FirstName}`;
                        checkinButton.onclick = () => checkInGuestAndSync(guestData, selectedEvent);
                        resultsDiv.appendChild(checkinButton);
                    }
                }
                return;
            }
        }
        resultsDiv.innerText = 'Visitor not found. Please register below.';
    } catch (err) {
        console.error('Error during search:', err);
        resultsDiv.innerText = `Search Error: ${err.result?.error?.message || err.message}`;
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
    if (!firstNameInput.value.trim() || !lastNameInput.value.trim() || !emailInput.value.trim()) {
        showModalMessage('First Name, Last Name, and Email are required.', 2500);
        return;
    }
    
    const walkinData = {
        isWalkIn: true, // Flag to indicate a new guest
        FirstName: firstNameInput.value.trim(),
        LastName: lastNameInput.value.trim(),
        Email: emailInput.value.trim(),
        Phone: phoneInput.value.trim(),
        // These are for the Visitors sheet sync
        DateJoined: new Date().toLocaleString(),
        Subscribed: subscribeCheckbox.checked ? 'Yes' : 'No'
    };
    
    if(currentMode === 'general'){
        generalRegisterAndCheckIn(walkinData);
    } else {
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
            EventName: 'General Visit'
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


async function checkInGuestAndSync(guestData, eventDetails) {
    resultsDiv.innerHTML = `<p>Checking in ${guestData.FirstName}...</p>`;
    resultsDiv.style.display = 'block';
    updateGuestInfoSection.style.display = 'none';
    registrationForm.style.display = 'none';
    searchContainer.style.display = 'block';
    clearAllTimers();

    try {
        // Step 1: Find or Create Visitor Record to get VisitorID
        const visitorId = await findOrCreateVisitor(guestData);

        // Step 2: Update or Append to the Event Sheet
        const timestamp = new Date().toLocaleString();
        guestData.CheckinTimestamp = timestamp;

        if (guestData.isWalkIn) {
            const guestRow = await prepareRowData(eventDetails.GuestListSheetName, guestData, GUEST_HEADER_MAP);
            await appendSheetValues(eventDetails.GuestListSheetName, [guestRow]);
        } else {
            const range = `${eventDetails.GuestListSheetName}!A${guestData.rowIndex}:E${guestData.rowIndex}`;
            const updatedGuestRow = await prepareRowData(eventDetails.GuestListSheetName, guestData, GUEST_HEADER_MAP);
            await updateSheetValues(range, [updatedGuestRow]);
        }
        
        // Step 3: Log in the main Checkins Sheet
        const checkinLogData = {
            Timestamp: timestamp,
            VisitorID: visitorId,
            FullName: `${guestData.FirstName} ${guestData.LastName}`.trim(),
            EventName: eventDetails.EventName
        };
        const checkinRow = await prepareRowData(CHECKINS_SHEET_NAME, checkinLogData, CHECKINS_HEADER_MAP);
        await appendSheetValues(CHECKINS_SHEET_NAME, [checkinRow]);
        
        resultsDiv.innerText = `Successfully checked in ${guestData.FirstName} for ${eventDetails.EventName}!`;
        rotateBackgroundImage();
        setTimeout(resetToModeSelection, 2500);

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
        const headers = rows[0].map(h => h.toLowerCase());
        const emailIndex = headers.indexOf('email');
        const idIndex = headers.indexOf('visitor id');

        if (emailIndex > -1 && idIndex > -1) {
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][emailIndex] && rows[i][emailIndex].toLowerCase() === guestData.Email.toLowerCase()) {
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

