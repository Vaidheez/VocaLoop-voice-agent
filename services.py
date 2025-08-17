import os
import json
import logging
import shutil
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
import assemblyai as aai
from murf import Murf
import google.generativeai as genai
from fastapi import UploadFile
from starlette.concurrency import run_in_threadpool

# Load environment variables
load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize API clients with keys from environment variables
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
murf = Murf(api_key=os.getenv("MURF_API_KEY"))
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
gemini_model = genai.GenerativeModel("gemini-1.5-flash")

# Define directories for file storage
HISTORY_DIR = "chat_history"
os.makedirs(HISTORY_DIR, exist_ok=True)
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def load_chat_history(session_id: str) -> List[Dict[str, Any]]:
    """Loads chat history from a JSON file for a given session ID."""
    history_file = os.path.join(HISTORY_DIR, f"{session_id}.json")
    if not os.path.exists(history_file):
        return []
    try:
        with open(history_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Error decoding JSON from history file: {history_file}. Starting new history. Error: {e}")
        return []

def _save_chat_history(session_id: str, chat_history: List[Dict[str, Any]]):
    """Synchronous helper to save chat history."""
    history_file = os.path.join(HISTORY_DIR, f"{session_id}.json")
    with open(history_file, 'w', encoding='utf-8') as f:
        json.dump(chat_history, f, indent=4)
    logger.info(f"Saved chat history for session: {session_id}")

async def save_chat_history(session_id: str, user_text: str, llm_response: str):
    """Asynchronously saves new chat history to a JSON file."""
    chat_history = load_chat_history(session_id)
    chat_history.append({"role": "user", "parts": [user_text]})
    chat_history.append({"role": "model", "parts": [llm_response]})
    await run_in_threadpool(_save_chat_history, session_id, chat_history)

def _get_transcription_sync(file_path: str) -> str:
    """Synchronous helper for AssemblyAI transcription."""
    transcriber = aai.Transcriber()
    transcript = transcriber.transcribe(file_path)
    if transcript.status == aai.TranscriptStatus.completed:
        return transcript.text or ""
    logger.error(f"AssemblyAI transcription failed with status: {transcript.status}")
    return ""

async def get_assemblyai_transcription(file: UploadFile) -> str:
    """Sends an audio file to AssemblyAI for transcription in a background thread."""
    temp_path = os.path.join(UPLOAD_DIR, file.filename)
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        transcription = await run_in_threadpool(_get_transcription_sync, temp_path)
        return transcription
    except Exception as e:
        logger.error(f"Error during AssemblyAI transcription: {e}", exc_info=True)
        return ""
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

async def get_gemini_response(transcription: str, chat_history: List[Dict[str, Any]]) -> str:
    """Gets a contextual response from Google Gemini."""
    try:
        chat = gemini_model.start_chat(history=chat_history)
        response = await chat.send_message_async(transcription)
        return response.text
    except Exception as e:
        logger.error(f"Error getting response from Gemini: {e}", exc_info=True)
        return "I'm having trouble connecting right now. Please try again in a moment."

async def get_murf_audio_url(text: str, voice_id: str) -> Optional[str]:
    """Generates an audio file from Murf AI and returns its URL."""
    try:
        response = murf.text_to_speech.generate(
            text=text,
            voice_id=voice_id,
        )
        return response.audio_file
    except Exception as e:
        logger.error(f"Error generating audio with Murf AI: {e}", exc_info=True)
        return None