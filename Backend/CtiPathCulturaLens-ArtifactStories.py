"""
Lambda function for generating cultural stories based on artifact descriptions.

This module takes an artifact description and generates cultural stories for each
cultural view. It uses multi-threading to generate stories in parallel and can
optionally create audio files for each story.
"""

import json
import boto3
import threading
import queue
import time
import base64
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Any, Optional, Union, Tuple

# Import common functions from layer
from ctipath_culturalens_common import (
    get_parameters, configure_logging, 
    get_s3_path, write_to_s3, call_bedrock_llm,
    write_audio_to_s3, invoke_lambda_function,
    chunk_text_by_paragraphs, concatenate_mp3_files
)

# Set up logging
logger = configure_logging()

# Initialize AWS clients
s3_client = boto3.client('s3')
bedrock_client = boto3.client('bedrock-runtime')
lambda_client = boto3.client('lambda')

def generate_cultural_story(preferences: Dict[str, str], culture: str, view: str, artifact_description: Dict[str, Any]) -> str:
    """
    Generates an immersive cultural story based on user preferences, cultural perspective,
    and artifact description. Uses Amazon Bedrock to create engaging narratives that
    place the artifact in real-world cultural contexts with appropriate characters and dialogue.
    
    The function constructs a detailed prompt that instructs the AI to:
    - Create stories based on real-world contexts (not museum/gallery settings)
    - Include engaging characters and dialogue appropriate to the cultural perspective
    - Match tone and complexity to user age preferences
    - Generate content in the user's preferred language
    - Focus on experiential storytelling rather than factual information
    
    Args:
        preferences: User preferences including:
            - age_preference: Target age group for story complexity
            - gender_preference: Character gender preferences
            - language_preference: Output language for the story
            - voice_preference: Audio voice selection (used elsewhere)
        culture: Name/description of the cultural perspective for the story
        view: Specific cultural viewpoint on the artifact from that culture
        artifact_description: Complete artifact metadata including:
            - description: Visual description of the artifact
            - historical_description: Historical context
            - cultural_description: Cultural significance
            - Other metadata fields
        
    Returns:
        str: Generated cultural story text tailored to preferences and perspective
        
    Raises:
        RuntimeError: If story generation fails due to Bedrock API errors
    """
    try:
        # Get parameters from Parameter Store
        parameters = get_parameters()
        nova_model_id = parameters.get('NovaModelId', 'amazon.nova-lite-v1:0')
        
        # Build preferences prompt
        preferences_prompt = ""
        if 'age_preference' in preferences:
            preferences_prompt += f"Age preference: {preferences['age_preference']}\n"
        if 'gender_preference' in preferences:
            preferences_prompt += f"Gender preference: {preferences['gender_preference']}\n"
        if 'language_preference' in preferences:
            preferences_prompt += f"Output language preference: {preferences['language_preference']}\n"

        if 'description' in artifact_description:
            image_description = f"Image Description:\n{artifact_description['description']}\n"
        else:
            image_description = ""

        # Build structured prompt for Nova
        system_prompt = parameters.get('ArtifactStoriesSystemPrompt')
        message_prompt = parameters.get('ArtifactStoriesMessagePrompt').format(
            image_description=image_description,
            culture=culture,
            view=view,
            preferences_prompt=preferences_prompt
        )

        # Define a "user" message with the prompt
        message_list = [
            {
                "role": "user",
                "content": [
                    {
                        "text": f"{message_prompt}"
                    }
                ],
            }
        ]
        
        logger.info(f"Calling Bedrock LLM model for cultural story")

        # Call Bedrock LLM using the common function
        content = call_bedrock_llm(nova_model_id, system_prompt, message_list)
        logger.info(f"Received content from LLM for cultural story")
        
        return content
                    
    except Exception as e:
        logger.error(f"Error generating cultural story: {str(e)}")
        raise RuntimeError(f"Failed to generate cultural story: {str(e)}")

def generate_story_audio(story_text: str, voice_id: str, story_index: int, s3_bucket: str, s3_path: str) -> str:
    """
    Generates MP3 audio files for cultural stories by invoking the StoryAudio Lambda function.
    Handles text chunking for large stories and concatenates multiple audio segments
    into a single seamless MP3 file stored in S3.
    
    The process involves:
    1. Validating the story text is not empty
    2. Breaking large stories into chunks that fit Polly's character limits
    3. Generating audio for each chunk via the StoryAudio Lambda
    4. Concatenating all audio chunks into a single MP3
    5. Storing the final audio file in S3
    
    Args:
        story_text: Complete text of the story to convert to audio
        voice_id: Amazon Polly voice identifier (e.g., "Joanna", "Matthew")
        story_index: Zero-based index of the story for unique file naming
        s3_bucket: S3 bucket name for audio file storage
        s3_path: S3 path prefix where audio file will be stored
        
    Returns:
        str: Filename of the generated audio file (not the full S3 key), 
             or empty string if audio generation fails or text is empty
        
    Raises:
        Does not raise exceptions - returns empty string on failure to allow
        story generation to continue even if audio generation fails
    """
    try:
        logger.info(f"Generating audio for story {story_index+1} with voice {voice_id}")
        
        # Check if the text is empty
        if not story_text or len(story_text.strip()) == 0:
            logger.warning(f"Empty story text for story {story_index+1}, skipping audio generation")
            return ""
        
        # Split the story into chunks based on paragraphs (max 3000 chars)
        text_chunks = chunk_text_by_paragraphs(story_text, max_chars=3000)
        logger.info(f"Split story into {len(text_chunks)} chunks")
        
        # Generate audio for each chunk
        audio_data_list = []
        
        for chunk_index, chunk_text in enumerate(text_chunks):
            # Invoke the StoryAudio Lambda function directly
            logger.info(f"Generating audio for chunk {chunk_index+1}/{len(text_chunks)}")
            
            # Prepare the payload for StoryAudio
            payload = {
                "text": chunk_text,
                "voiceId": voice_id,
                "storyIndex": story_index,
                "chunkIndex": chunk_index
            } 
                       
            # Invoke the Lambda function
            try:
                response = invoke_lambda_function("CtiPathCulturaLens-StoryAudio", payload)
                
                # Process the response - now this will be the direct response object
                if isinstance(response, dict) and 'audioData' in response:
                    # Extract the base64-encoded audio data
                    audio_data = base64.b64decode(response['audioData'])
                    logger.info(f"Received audio data for chunk {chunk_index}, size: {len(audio_data)} bytes")
                    audio_data_list.append(audio_data)
                else:
                    logger.warning(f"No audio data in response for chunk {chunk_index}: {response}")
            except Exception as e:
                logger.error(f"Error invoking StoryAudio for chunk {chunk_index}: {str(e)}")
                # Continue with other chunks - don't throw an exception here
                continue
        
        # Concatenate all audio chunks into a single MP3 file
        if audio_data_list:
            logger.info(f"Concatenating {len(audio_data_list)} audio chunks")
            combined_audio = concatenate_mp3_files(audio_data_list)
            
            # Generate filename and full S3 key
            audio_filename = f"story_audio_{story_index+1}.mp3"
            audio_key = f"{s3_path}{audio_filename}"
            
            # Save the combined audio to S3
            write_audio_to_s3(s3_bucket, audio_key, combined_audio)
            logger.info(f"Successfully wrote combined audio to {audio_key}")
            
            # Return only the filename, not the full S3 key
            return audio_filename
        else:
            logger.warning("No audio data generated")
            return ""
        
    except Exception as e:
        logger.error(f"Error generating story audio: {str(e)}")
        # Don't raise the exception, just return empty string
        # This ensures the main process continues even if audio generation fails
        return ""
            
def generate_story_worker(
    preferences: Dict[str, str], 
    culture: str, 
    view: str, 
    artifact_description: Dict[str, Any], 
    result_queue: queue.Queue, 
    index: int,
    should_generate_audio: bool,
    s3_bucket: str,
    s3_path: str
) -> None:
    """
    Worker function for parallel story generation in separate threads. Handles
    story generation with timeout protection and optional audio generation.
    Ensures thread-safe communication through queue-based result collection.
    
    This function is designed to run in a separate thread and includes:
    - Timeout protection to prevent hanging threads
    - Comprehensive error handling with fallback responses
    - Optional audio generation based on configuration
    - Thread-safe result collection via queue
    - Original index preservation for maintaining story order
    
    Args:
        preferences: User preferences for story customization including age,
                    gender, language, and voice settings
        culture: Cultural perspective name/description for the story
        view: Specific cultural viewpoint on the artifact
        artifact_description: Complete artifact metadata including descriptions
        result_queue: Thread-safe queue for collecting results from all workers
        index: Original index in the cultural_views list for maintaining order
        should_generate_audio: Whether to generate accompanying audio files
        s3_bucket: S3 bucket name for audio file storage
        s3_path: S3 path prefix for organizing audio files
        
    Returns:
        None: Results are placed in the result_queue for collection by main thread
    """
    logger = configure_logging()
    story_entry = None
    try:
        # Set a timeout for story generation (5 minutes)
        timeout = 300  # seconds

        # Use a thread pool to allow timeout on the story generation
        with ThreadPoolExecutor(max_workers=1) as executor:
            # Submit the task
            future = executor.submit(
                generate_cultural_story,
                preferences,
                culture,
                view,
                artifact_description
            )
            
            # Wait for result with timeout
            try:
                # Generate the story with timeout
                story_result = future.result(timeout=timeout)
                
                # Get voice preference from preferences or use default
                voice_id = preferences.get('voice_preference', 'Joanna')
                
                # Initialize story_audio field
                story_audio = ""
                
                # Generate audio if enabled
                if should_generate_audio:
                    story_audio = generate_story_audio(
                        story_result, 
                        voice_id, 
                        index, 
                        s3_bucket, 
                        s3_path
                    )
                
                # Create a complete entry with culture, view, story, story_audio field, and original index
                story_entry = {
                    "culture": culture,
                    "view": view,
                    "culture_story": story_result,
                    "story_audio": story_audio,  # Add story_audio field with S3 path
                    "original_index": index  # Store the original index for re-ordering
                }
                
                logger.info(f"Successfully generated story for culture: {culture}")
                
            except TimeoutError:
                logger.error(f"Story generation timed out for culture: {culture}")
                # Create a placeholder for timeout
                story_entry = {
                    "culture": culture,
                    "view": view,
                    "culture_story": f"The story generation timed out. Please try again later.",
                    "story_audio": "",
                    "original_index": index
                }
                
    except Exception as e:
        logger.error(f"Error in generate_story_worker: {str(e)}")
        # Add a placeholder error entry to ensure we maintain ordering
        if story_entry is None:  # Only create a new entry if we don't already have one
            story_entry = {
                "culture": culture,
                "view": view,
                "culture_story": f"Error generating story: {str(e)}",
                "story_audio": "",
                "original_index": index
            }
    
    finally:
        # Always ensure we add something to the queue so we don't deadlock
        if story_entry is not None:
            # Add to queue
            result_queue.put(story_entry)
        else:
            # Fallback if somehow we got here without a story_entry
            result_queue.put({
                "culture": culture,
                "view": view,
                "culture_story": "Error generating story: Unknown error",
                "story_audio": "",
                "original_index": index
            })

def generate_all_cultural_stories(
    preferences: Dict[str, str], 
    cultural_views: List[Dict[str, str]], 
    artifact_description: Dict[str, Any],
    should_generate_audio: bool,
    s3_bucket: str,
    s3_path: str
) -> List[Dict[str, str]]:
    """
    Orchestrates parallel generation of cultural stories for all cultural views
    using multi-threading for performance. Manages timeouts, error handling,
    and result collection while maintaining original story ordering.
    
    This function implements a robust parallel processing strategy:
    - Creates separate threads for each cultural story generation
    - Uses a thread-safe queue for collecting results
    - Implements timeout protection to prevent hanging operations
    - Maintains original ordering through index tracking
    - Handles partial failures gracefully
    - Provides comprehensive logging for debugging
    
    The parallel approach significantly reduces total processing time when
    generating multiple stories, especially when audio generation is enabled.
    
    Args:
        preferences: User preferences for story customization including:
            - age_preference: Target age group
            - gender_preference: Character preferences
            - language_preference: Output language
            - voice_preference: Audio voice selection
        cultural_views: List of cultural perspective objects, each containing:
            - culture: Cultural perspective name/description
            - view: Specific viewpoint on the artifact
        artifact_description: Complete artifact metadata and description
        should_generate_audio: Whether to generate audio for all stories
        s3_bucket: S3 bucket name for audio file storage
        s3_path: S3 path prefix for organizing audio files by artifact
        
    Returns:
        list: List of cultural stories with complete metadata:
            - culture: Cultural perspective name
            - view: Cultural viewpoint description
            - culture_story: Generated story text
            - story_audio: Audio filename (if generated) or empty string
    """
    logger = configure_logging()
    
    # Create a thread-safe queue for results
    result_queue = queue.Queue()
    threads = []
    valid_views_count = 0
    
    # Start a thread for each cultural view
    for i, cultural_view in enumerate(cultural_views):
        culture = cultural_view.get('culture', '')
        view = cultural_view.get('view', '')
        
        if not culture or not view:
            logger.warning(f"Missing culture or view in cultural view: {cultural_view}")
            continue
        
        # Create and start a thread for this cultural view
        thread = threading.Thread(
            target=generate_story_worker,
            args=(
                preferences, 
                culture, 
                view, 
                artifact_description, 
                result_queue, 
                valid_views_count,
                should_generate_audio,
                s3_bucket,
                s3_path
            )
        )
        thread.daemon = True  # Set daemon to True so thread doesn't block program exit
        thread.start()
        threads.append(thread)
        valid_views_count += 1
    
    # Set a maximum wait time for all threads to complete
    max_wait_time = 360  # 6 minutes
    start_time = time.time()
    
    # Wait for threads to complete or timeout
    for thread in threads:
        # Calculate remaining wait time
        elapsed = time.time() - start_time
        remaining = max(0, max_wait_time - elapsed)
        
        # Wait with timeout for thread to complete
        thread.join(timeout=remaining)
        
        # If thread is still alive after timeout, we log it but continue
        if thread.is_alive():
            logger.warning(f"Thread did not complete within timeout period")
    
    # Collect results from the queue
    all_stories = []
    while not result_queue.empty():
        all_stories.append(result_queue.get())
    
    # Check if we got all stories
    if len(all_stories) != valid_views_count:
        logger.warning(f"Expected {valid_views_count} stories but only got {len(all_stories)}")
    
    # Sort the stories based on the original index to maintain order
    all_stories.sort(key=lambda x: x.get('original_index', 0))
    
    # Remove the temporary "original_index" field
    for story in all_stories:
        if 'original_index' in story:
            del story['original_index']
    
    logger.info(f"Generated {len(all_stories)} cultural stories in parallel")
    return all_stories

def delete_mp3_files(bucket: str, prefix: str) -> int:
    """
    Removes all MP3 audio files from a specified S3 location to clean up
    before generating new audio content. Prevents accumulation of outdated
    audio files when stories are regenerated.
    
    This function performs a thorough cleanup by:
    - Listing all objects under the specified prefix
    - Filtering for MP3 files based on file extension
    - Batch deleting all found MP3 files
    - Providing count of deleted files for logging
    
    Args:
        bucket: S3 bucket name containing the MP3 files
        prefix: S3 prefix (directory path) to search for MP3 files
        
    Returns:
        int: Number of MP3 files successfully deleted
    
    Raises:
        RuntimeError: If there's an error during the deletion process
    """
    try:
        # List all objects with the specified prefix
        response = s3_client.list_objects_v2(
            Bucket=bucket,
            Prefix=prefix
        )
        
        # Filter for MP3 files
        mp3_files = []
        if 'Contents' in response:
            for obj in response['Contents']:
                key = obj['Key']
                if key.lower().endswith('.mp3'):
                    mp3_files.append({'Key': key})
        
        # Delete the MP3 files if any were found
        if mp3_files:
            logger.info(f"Deleting {len(mp3_files)} MP3 files from {prefix}")
            
            # S3 delete_objects requires a specific format
            s3_client.delete_objects(
                Bucket=bucket,
                Delete={
                    'Objects': mp3_files
                }
            )
            
            return len(mp3_files)
        
        logger.info(f"No MP3 files found to delete in {prefix}")
        return 0
        
    except Exception as e:
        logger.error(f"Error deleting MP3 files: {str(e)}")
        raise RuntimeError(f"Failed to delete MP3 files: {str(e)}")
    
def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for generating cultural stories from artifact descriptions.
    Triggered by API Gateway, this function coordinates the entire story generation
    process including parallel story creation, optional audio generation, and S3 storage.
    
    The function orchestrates the following workflow:
    1. Validates and extracts request parameters from API Gateway event
    2. Retrieves configuration settings including auto-audio creation
    3. Extracts artifact description and cultural views for processing
    4. Cleans up any existing audio files in the artifact directory
    5. Generates stories in parallel for all cultural perspectives
    6. Optionally generates audio files for each story
    7. Stores results in S3 for future retrieval
    8. Returns generated stories in API Gateway response format
    
    The function supports automatic audio generation based on the AutoAudioCreation
    parameter, allowing system-wide control over audio file creation.
    
    Args:
        event: Lambda event object from API Gateway containing:
            - body: JSON with artifactDescription, culturalPreferences, userId, artifactId
        context: Lambda context object with runtime information
        
    Returns:
        dict: API Gateway response with CORS headers containing:
            - statusCode: HTTP response code (200 for success, 4xx/5xx for errors)
            - headers: CORS headers for web application compatibility
            - body: JSON array of generated cultural stories with metadata
    """
    # Define CORS headers
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'  # For CORS support
    }
    
    try:
        # Get parameters from Parameter Store
        parameters = get_parameters()
        s3_bucket = parameters.get('S3Bucket', 'ctipath-culturalens')
        
        # Check if auto audio creation is enabled
        auto_audio_creation_value = parameters.get('AutoAudioCreation', 'false')
        logger.info(f"AutoAudioCreation parameter value: '{auto_audio_creation_value}'")
        auto_audio_creation = auto_audio_creation_value.lower() == 'true'
        logger.info(f"Auto audio creation is {'enabled' if auto_audio_creation else 'disabled'}")

        logger.info(f"Event: {json.dumps(event)}")
        
        # Extract the request body
        if 'body' in event:
            # If body is a string (which is common with API Gateway), parse it
            if isinstance(event['body'], str):
                body = json.loads(event['body'])
            else:
                body = event['body']
        else:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps('Missing request body')
            }
        
        # Extract data from the request body
        artifact_description = body.get('artifactDescription')
        cultural_preferences = body.get('culturalPreferences', {})
        user_id = body.get('userId')
        artifact_id = body.get('artifactId')
        
        # Validate required fields
        if not artifact_description:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps('Missing artifactDescription in request body')
            }
        
        if not user_id:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps('Missing userId in request body')
            }
        
        if not artifact_id:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps('Missing artifactId in request body')
            }
        
        # Get the necessary information from artifact_description
        image_key = artifact_description.get('object')
        cultural_views = artifact_description.get('cultural_views', [])
        identity_id = artifact_description.get('identityid') or artifact_description.get('identityId')
        
        # Validate required fields in artifact_description
        if not image_key:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps('Missing object in artifactDescription')
            }
        
        if not cultural_views or len(cultural_views) == 0:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps('No cultural views found in artifactDescription')
            }
        
        if not identity_id:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps('Missing identityId in artifactDescription')
            }
        
        # Define path for storing artifact stories
        s3_path = get_s3_path(identity_id, user_id, artifact_id)
        stories_key = f"{s3_path}artifact_stories.json"
        preferences_key = f"{s3_path}cultural_preferences.json"
        
        # Delete existing MP3 files in the same location
        files_deleted = delete_mp3_files(s3_bucket, s3_path)
        logger.info(f"Deleted {files_deleted} MP3 files from {s3_path}")
        
        # Generate stories for each cultural view
        all_stories = generate_all_cultural_stories(
            cultural_preferences, 
            cultural_views, 
            artifact_description,
            auto_audio_creation,
            s3_bucket,
            s3_path
        )
        
        # Write stories to S3
        write_to_s3(s3_bucket, stories_key, all_stories)
        logger.info(f"Successfully wrote {len(all_stories)} cultural stories to {stories_key}")
        write_to_s3(s3_bucket, preferences_key, cultural_preferences)
        logger.info(f"Successfully wrote cultural preferences to {preferences_key}")
        
        # Return success response with stories data
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(all_stories)
        }
    
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps(f'Error: {str(e)}')
        }