"""
Lambda function for generating audio from cultural stories with progressive streaming support.

This module uses Amazon Polly to convert cultural stories to audio (MP3).
It supports progressive audio generation by returning audio data directly in the response.
"""

import json
import boto3
import base64
from typing import Dict, List, Any

# Import common functions from layer
from ctipath_culturalens_common import (
    get_parameters, configure_logging
)

# Set up logging
logger = configure_logging()

# Initialize AWS clients
polly_client = boto3.client('polly')

def get_neural_voices() -> List[str]:
    """
    Retrieves the list of Amazon Polly voice IDs that should use the neural engine
    from AWS Systems Manager Parameter Store. Neural voices provide higher quality
    but are more expensive than standard voices.
    
    The neural engine produces more natural-sounding speech with better pronunciation,
    intonation, and emotional expression compared to the standard engine. However,
    neural voices have higher per-character costs and may have different availability
    across AWS regions.
    
    This function centralizes voice engine configuration, allowing system administrators
    to control which voices use the premium neural engine versus the standard engine
    through Parameter Store configuration.
    
    Returns:
        list: List of voice IDs configured to use neural engine (e.g., ["Joanna", "Matthew"])
              Falls back to default list if Parameter Store retrieval fails
    """
    try:
        # Get parameters from Parameter Store
        parameters = get_parameters()
        
        # Get the neural voices parameter
        neural_voices_param = parameters.get('NeuralVoices', "Joanna,Ivy,Justin,Matthew")
        
        # Split the comma-separated string into a list
        neural_voices = [voice.strip() for voice in neural_voices_param.split(',')]
        
        logger.info(f"Retrieved neural voices from Parameter Store: {neural_voices}")
        
        return neural_voices
    except Exception as e:
        logger.error(f"Error retrieving neural voices from Parameter Store: {str(e)}")
        # Return default neural voices if there's an error
        return ["Joanna", "Ivy", "Justin", "Matthew"]

def generate_audio_for_chunk(text: str, voice_id: str) -> bytes:
    """
    Converts a text chunk to speech using Amazon Polly with automatic engine selection
    (neural vs standard) based on voice capabilities. Handles text length limitations
    and provides fallback truncation for oversized content.
    
    This function implements a robust text-to-speech conversion strategy:
    - Automatically selects neural or standard engine based on voice configuration
    - Handles Polly's character limit constraints with graceful truncation
    - Provides detailed logging for audio generation monitoring
    - Returns binary MP3 data ready for streaming or storage
    - Implements fallback behavior for oversized text inputs
    
    The function handles two types of Polly engines:
    - Neural Engine: Higher quality, more natural speech, higher cost
    - Standard Engine: Good quality, faster processing, lower cost
    
    Character limits vary by engine and voice, so the function includes
    fallback truncation if the initial request exceeds Polly's limits.
    
    Args:
        text: Text chunk to convert to speech (should be under Polly's character limit)
        voice_id: Amazon Polly voice identifier (e.g., "Joanna", "Matthew", "Amy")
        
    Returns:
        bytes: MP3 audio content as binary data ready for storage or streaming
        
    Raises:
        RuntimeError: If audio generation fails after retry attempts with truncation
    """
    try:
        # Get the list of neural voices
        neural_voices = get_neural_voices()
        
        # Determine the engine to use - neural for specified voices, standard for others
        engine = "neural" if voice_id in neural_voices else "standard"
        logger.info(f"Generating audio for text of length: {len(text)} characters with voice ID: {voice_id} using {engine} engine")
        
        # Call Polly synchronously for fastest response
        response = polly_client.synthesize_speech(
            Text=f'{text} \n\n',
            OutputFormat='mp3',
            VoiceId=voice_id,
            Engine=engine
        )
        
        # The response contains AudioStream as a binary stream
        audio_content = response['AudioStream'].read()
        logger.info(f"Successfully generated audio of size: {len(audio_content)} bytes")
        
        return audio_content
            
    except Exception as e:
        logger.error(f"Error generating audio with Polly: {str(e)}")
        
        # If the error is related to text length, try with a shorter text
        if 'TextLengthExceededException' in str(e):
            logger.warning("Text length exceeded, truncating text")
            # Truncate the text
            truncated_text = text[:1000]  # Use a conservative limit
            
            # Try again with truncated text
            try:
                # Get neural voices again to ensure consistency
                neural_voices = get_neural_voices()
                engine = "neural" if voice_id in neural_voices else "standard"
                
                response = polly_client.synthesize_speech(
                    Text=truncated_text,
                    OutputFormat='mp3',
                    VoiceId=voice_id,
                    Engine=engine
                )
                audio_content = response['AudioStream'].read()
                logger.info(f"Generated audio for truncated text ({len(truncated_text)} chars)")
                return audio_content
            except Exception as inner_e:
                logger.error(f"Error with truncated text: {str(inner_e)}")
                # Re-raise the exception
                raise RuntimeError(f"Failed to generate audio: {str(inner_e)}")
        
        # Re-raise the exception
        raise RuntimeError(f"Failed to generate audio: {str(e)}")

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler supporting both API Gateway calls and direct Lambda invocations.
    Processes text-to-speech requests using Amazon Polly and returns base64-encoded
    audio data. Adapts response format based on invocation method.
    
    This function serves as a versatile audio generation endpoint that can handle:
    - Direct Lambda-to-Lambda invocations from other functions
    - API Gateway HTTP requests from web applications
    - Automatic response format adaptation based on event structure
    - Comprehensive error handling with appropriate response formatting
    - CORS header management for web application compatibility
    
    The function supports two invocation patterns:
    1. Direct Lambda Invocation: Event contains parameters directly
       - Faster processing, no HTTP overhead
       - Used by other Lambda functions in the application
       - Returns response object directly
    
    2. API Gateway Invocation: Event contains 'body' with parameters
       - HTTP-compatible for web applications
       - Includes CORS headers and HTTP status codes
       - Returns API Gateway formatted response
    
    Event Structure for Direct Invocation:
    {
        "text": "Story text to convert",
        "voiceId": "Joanna",
        "storyIndex": 0,
        "chunkIndex": 0
    }
    
    Event Structure for API Gateway:
    {
        "body": "{\"text\":\"Story text\",\"voiceId\":\"Joanna\",...}",
        "httpMethod": "POST",
        "headers": {...}
    }
    
    Args:
        event: Lambda event object with different structures based on invocation type:
            - Direct: Contains text, voiceId, storyIndex, chunkIndex directly
            - API Gateway: Contains body with JSON string of parameters
        context: Lambda context object with runtime information including:
            - remaining_time_in_millis: For timeout monitoring
            - aws_request_id: For request tracking and debugging
        
    Returns:
        dict: Response format adapted to invocation type:
            - Direct: {message, chunkIndex, audioData, storyIndex}
            - API Gateway: {statusCode, headers, body} with CORS support
    """
    # Define CORS headers
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'  # For CORS support
    }
    
    # Add comprehensive logging of the incoming event
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        logger.info(f"Starting lambda handler execution")
        
        # Extract the request body - handle both direct Lambda invocation and API Gateway events
        body = None
        
        # Check if this is a direct Lambda invocation (event contains parameters directly)
        if 'text' in event:
            body = event
            logger.info("Direct Lambda invocation detected")
        # Check if this is an API Gateway event (body is in event['body'])
        elif 'body' in event:
            # If body is a string (which is common with API Gateway), parse it
            if isinstance(event['body'], str):
                body = json.loads(event['body'])
            else:
                body = event['body']
            logger.info("API Gateway invocation detected")
        else:
            logger.error("Could not determine event type - missing expected fields")
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps('Invalid event format - missing required fields')
            }
        
        # Log the parsed body
        logger.info(f"Parsed body: {json.dumps(body)}")
        
        # Extract required data from the request body
        text = body.get('text')
        voice_id = body.get('voiceId', 'Joanna')
        story_index = body.get('storyIndex', 0)
        chunk_index = body.get('chunkIndex', 0)
        
        logger.info(f"Received request for voice: {voice_id}, story: {story_index}, chunk: {chunk_index}, text length: {len(text) if text else 0}")
        
        # Validate text
        if not text:
            logger.error("Missing text in request body")
            error_response = {
                'message': 'Missing text in request body'
            }
            
            # Determine response format based on invocation type
            if 'body' in event or 'httpMethod' in event:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps(error_response)
                }
            else:
                return error_response
        
        # Generate audio for the text chunk
        try:
            logger.info("Calling generate_audio_for_chunk")
            audio_content = generate_audio_for_chunk(text, voice_id)
            
            # Encode the audio content as base64 for direct return in the API response
            audio_data_base64 = base64.b64encode(audio_content).decode('utf-8')
            logger.info(f"Successfully generated audio of size: {len(audio_content)} bytes (raw) / {len(audio_data_base64)} bytes (base64)")
            
            # Return the audio data directly in the response
            response_body = {
                'message': f'Successfully generated audio for chunk {chunk_index}',
                'chunkIndex': chunk_index,
                'audioData': audio_data_base64,
                'storyIndex': story_index
            }
            
            # Determine the appropriate response format based on invocation type
            if 'body' in event or 'httpMethod' in event:
                # API Gateway invocation requires a structured response
                result = {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps(response_body)
                }
            else:
                # Direct Lambda invocation - return the response body directly
                result = response_body
            
            logger.info(f"Returning successful response with {len(audio_data_base64)} bytes of audio data")
            return result
            
        except Exception as audio_err:
            logger.error(f"Error generating audio: {str(audio_err)}", exc_info=True)
            error_message = f'Error generating audio: {str(audio_err)}'
            
            # Determine response format based on invocation type
            if 'body' in event or 'httpMethod' in event:
                return {
                    'statusCode': 500,
                    'headers': headers,
                    'body': json.dumps(error_message)
                }
            else:
                return {'error': error_message}
            
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}", exc_info=True)
        error_message = f'Error: {str(e)}'
        
        # Determine response format based on invocation type
        if 'body' in event or 'httpMethod' in event:
            return {
                'statusCode': 500,
                'headers': headers,
                'body': json.dumps(error_message)
            }
        else:
            return {'error': error_message}