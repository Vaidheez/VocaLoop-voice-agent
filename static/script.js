const recordButton = document.getElementById('record-button');
const echoAudioPlayer = document.getElementById('echo-audio-player');
const echoStatusMessage = document.getElementById('echo-status-message');
const waveformContainer = document.getElementById('waveform-container');
const echoVoiceSelector = document.getElementById('echo-voice-selector');
const chatHistoryContainer = document.getElementById('chat-history-container');
const sessionIdDisplay = document.getElementById('session-id-display');
const historyToggleButton = document.getElementById('history-toggle-button');

let mediaRecorder;
let audioChunks = [];
let sessionId;
let isRecording = false;

// Function to generate a new session ID
function generateSessionId() {
    return uuidv4();
}

// Function to get a UUID (v4)
function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

// Function to create a new message element in the chat history
function addMessageToChatHistory(sender, text) {
    const messageContainer = document.createElement('div');
    messageContainer.classList.add('chat-message');

    const senderElement = document.createElement('span');
    senderElement.classList.add('chat-sender');
    senderElement.textContent = `${sender}: `;

    const textElement = document.createElement('span');
    textElement.textContent = text;
    
    if (sender === "You") {
        messageContainer.classList.add('user-message');
    } else {
        messageContainer.classList.add('ai-message');
    }

    messageContainer.appendChild(senderElement);
    messageContainer.appendChild(textElement);
    chatHistoryContainer.appendChild(messageContainer);
    chatHistoryContainer.scrollTop = chatHistoryContainer.scrollHeight; // Auto-scroll to the bottom
}

// Get or create a session ID on page load
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('session_id')) {
        sessionId = urlParams.get('session_id');
        sessionIdDisplay.textContent = `Session ID: ${sessionId}`;
        console.log(`Continuing session with ID: ${sessionId}`);
    } else {
        sessionId = generateSessionId();
        const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?session_id=${sessionId}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        sessionIdDisplay.textContent = `Session ID: ${sessionId}`;
        console.log(`Created new session with ID: ${sessionId}`);
    }
});

// --- Recording & Conversational Logic ---
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            recordButton.textContent = "Processing...";
            recordButton.classList.remove('is-recording', 'pulse-red');
            echoStatusMessage.textContent = "Transcribing, thinking, and generating audio...";
            echoStatusMessage.classList.remove('success', 'error');
            waveformContainer.style.display = 'none';
            
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

            const filename = `recording-${new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')}.webm`;
            const formData = new FormData();
            formData.append('file', audioBlob, filename);

            try {
                const selectedVoiceId = echoVoiceSelector.value;
                const response = await fetch(`http://localhost:8000/agent/chat/${sessionId}?voice_id=${selectedVoiceId}`, {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    echoStatusMessage.innerHTML = `<span style="color: red;">Error: ${data.detail || 'An unknown error occurred.'}</span>`;
                    echoStatusMessage.classList.add('error');
                    if (data.murf_audio_url) {
                        echoAudioPlayer.src = data.murf_audio_url;
                        echoAudioPlayer.play();
                    } else {
                        // Throw an error to be caught by the catch block below
                        throw new Error(data.detail || 'An unknown error occurred.');
                    }
                } else {
                    const murfAudioUrl = data.murf_audio_url;

                    echoStatusMessage.innerHTML = `<span style="color: green;">Processing successful!</span>`;
                    echoStatusMessage.classList.add('success');
                    
                    addMessageToChatHistory("You", data.transcription);
                    addMessageToChatHistory("AI", data.llm_response);
                    
                    if (murfAudioUrl) {
                        echoAudioPlayer.src = murfAudioUrl;
                        echoAudioPlayer.play();
                    } else {
                        echoStatusMessage.innerHTML = `<span style="color: red;">Error: Murf audio URL not found.</span>`;
                    }
                }

            } catch (error) {
                console.error('Error during processing:', error);
                echoStatusMessage.innerHTML = `<span style="color: red;">Error: ${error.message}</span>`;
                echoStatusMessage.classList.add('error');
                recordButton.textContent = "TALK"; // Reset button text
            }
        };

        mediaRecorder.start();
        echoStatusMessage.textContent = "Recording...";
        echoStatusMessage.classList.remove('success', 'error');
        recordButton.textContent = "STOP";
        recordButton.classList.add('is-recording', 'pulse-red');
        waveformContainer.style.display = 'flex';

    } catch (err) {
        echoStatusMessage.textContent = `Error: ${err.message}. Please allow microphone access.`;
        echoStatusMessage.classList.add('error');
        console.error('Error accessing microphone:', err);
    }
}

// Single button click handler
recordButton.addEventListener('click', () => {
    if (isRecording) {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        isRecording = false;
    } else {
        isRecording = true;
        startRecording();
    }
});

// Auto-record after audio has finished playing
echoAudioPlayer.addEventListener('ended', () => {
    isRecording = false;
    recordButton.textContent = "TALK";
    echoStatusMessage.textContent = "Press the button and start talking.";
});

// Toggle chat history visibility
historyToggleButton.addEventListener('click', async () => {
    const isVisible = chatHistoryContainer.classList.toggle('is-visible');
    historyToggleButton.textContent = isVisible ? '💬 Hide History' : '💬 Show History';

    if (isVisible) {
        try {
            const response = await fetch(`http://localhost:8000/history/${sessionId}`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail);
            }
            const data = await response.json();
            chatHistoryContainer.innerHTML = '';
            data.history.forEach(message => {
                const sender = message.role === 'user' ? 'You' : 'AI';
                addMessageToChatHistory(sender, message.parts[0]);
            });
        } catch (error) {
            console.error('Failed to fetch history:', error);
            chatHistoryContainer.innerHTML = `<div style="color: red; padding: 12px;">Error: ${error.message}</div>`;
        }
    }
});