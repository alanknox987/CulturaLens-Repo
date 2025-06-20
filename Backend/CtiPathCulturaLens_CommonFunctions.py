"""
Common utility functions for the CtiPathCulturaLens application.

This module provides shared functionality used across multiple Lambda functions
in the CtiPathCulturaLens application, including parameter retrieval,
logging configuration, and S3 operations.
"""

import json
import boto3
import logging
import base64
import os
import re
import time
from typing import Dict, List, Union, Optional, Any, Tuple

# Global clients initialized when the layer is loaded
ssm_client = boto3.client('ssm')
s3_client = boto3.client('s3')
bedrock_client = boto3.client('bedrock-runtime')

# Cache for parameters to avoid repeated calls to Parameter Store
# Will be maintained between lambda invocations for efficiency
_parameter_cache: Dict[str, str] = {}
_parameter_cache_ttl: float = 0  # Timestamp when cache expires

def get_parameters(force_refresh: bool = False) -> Dict[str, str]:
    """
    Retrieves all configuration parameters from AWS Systems Manager Parameter Store
    with caching for performance optimization. Parameters are cached for 15 minutes
    to reduce API calls and improve Lambda performance.
    
    Args:
        force_refresh: Whether to force a refresh of the parameter cache
        
    Returns:
        Dictionary of parameter name -> parameter value
    """
    # If parameters are already cached and not expired, return them
    global _parameter_cache, _parameter_cache_ttl
    current_time = time.time()
    
    # If cache is valid and not forced refresh, return cached params
    if _parameter_cache and _parameter_cache_ttl > current_time and not force_refresh:
        return _parameter_cache
    
    try:
        # Get all parameters with the prefix CtiPathCulturaLens
        response = ssm_client.get_parameters_by_path(
            Path='/CtiPathCulturaLens/',
            Recursive=True,
            WithDecryption=True
        )
        
        # Process parameters into a dictionary
        parameters: Dict[str, str] = {}
        for param in response.get('Parameters', []):
            # Extract parameter name without the path prefix
            param_name = param['Name'].split('/')[-1]
            parameters[param_name] = param['Value']
        
        # Retrieve additional pages if there are more parameters
        while 'NextToken' in response:
            response = ssm_client.get_parameters_by_path(
                Path='/CtiPathCulturaLens/',
                Recursive=True,
                WithDecryption=True,
                NextToken=response['NextToken']
            )
            
            for param in response.get('Parameters', []):
                param_name = param['Name'].split('/')[-1]
                parameters[param_name] = param['Value']
        
        # Update the cache and set TTL to 15 minutes
        _parameter_cache = parameters
        _parameter_cache_ttl = current_time + 900  # 15 minutes
        
        return parameters
    
    except Exception as e:
        logger = logging.getLogger()
        logger.error(f"Error retrieving parameters: {str(e)}")
        # Return default parameters if there's an error
        return {
            'S3Bucket': 'ctipath-culturalens',
            'NovaModelId': 'amazon.nova-lite-v1:0',
            'TableName': 'CtiPathCulturaLens-Preferences',
            'LogLevel': 'INFO',
            'NeuralVoices': 'Joanna,Ivy,Justin,Matthew'
        }

def configure_logging() -> logging.Logger:
    """
    Configures the Python logging system based on the LogLevel parameter from Parameter Store.
    Sets up a standardized logging format and returns a configured logger instance.
    
    Returns:
        Logger: Configured logger instance ready for use
    """
    params = get_parameters()
    log_level = params.get('LogLevel', 'INFO')
    
    # Convert string log level to logging module constant
    numeric_level = getattr(logging, log_level.upper(), None)
    if not isinstance(numeric_level, int):
        # Default to INFO if the specified level is not valid
        numeric_level = logging.INFO
    
    # Configure the root logger
    logger = logging.getLogger()
    logger.setLevel(numeric_level)
    
    # Configure handler format if no handlers exist yet
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    
    # Return the logger for convenience
    return logger

def sanitize_path_component(component: str) -> str:
    """
    Sanitizes a path component for safe use in S3 object keys by removing
    or replacing potentially dangerous characters. Special handling for 
    Cognito identity IDs which contain colons that should be preserved.
    
    Args:
        component: The path component to sanitize
        
    Returns:
        str: Sanitized path component safe for use in S3 keys
    """
    if not component:
        return ""
    
    # Special case for Cognito identity IDs which contain colons
    if re.match(r'^[a-z0-9\-]+:[a-f0-9\-]+$', component):
        # This is likely a Cognito identity ID, so preserve the colon
        return component
    
    # For other components, replace unsafe characters with underscores
    sanitized = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', component)
    
    # Limit length to reasonable size
    if len(sanitized) > 100:
        sanitized = sanitized[:100]
        
    return sanitized

def get_s3_path(identity_id: str, user_id: str, artifact_id: str) -> str:
    """
    Constructs a standardized S3 path for storing artifact-related data.
    Includes input sanitization to prevent path traversal attacks and 
    ensures consistent file organization across the application.
    
    Args:
        identity_id: AWS Cognito identity ID
        user_id: Application user identifier
        artifact_id: Unique identifier for the artifact
        
    Returns:
        str: Formatted S3 path with trailing slash
    """
    # Sanitize inputs to prevent path traversal
    user_id_safe = sanitize_path_component(user_id)
    artifact_id_safe = sanitize_path_component(artifact_id)
    
    return f"public/{user_id_safe}/{artifact_id_safe}/"

def check_file_exists(bucket: str, key: str) -> bool:
    """
    Checks if a specific file exists in an S3 bucket using a HEAD request
    which is more efficient than attempting to download the object.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key (file path)
        
    Returns:
        bool: True if the file exists, False otherwise
    """
    try:
        s3_client.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False

def extract_image_content(bucket: str, key: str) -> str:
    """
    Retrieves an image from S3 and encodes it as base64 for use with
    AI/ML services that require base64-encoded image data.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key for the image file
        
    Returns:
        str: Base64-encoded image content
    
    Raises:
        ValueError: If the image cannot be retrieved or encoded
    """
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        image_content = response['Body'].read()
        
        # Convert image to base64 for API
        base64_image = base64.b64encode(image_content).decode('utf-8')
        return base64_image
    except Exception as e:
        logger = logging.getLogger()
        logger.error(f"Error extracting image content: {str(e)}")
        raise ValueError(f"Could not retrieve image from S3: {str(e)}")

def read_from_s3(bucket: str, key: str) -> Union[Dict, List, str]:
    """
    Reads content from an S3 object and attempts to parse it as JSON.
    If JSON parsing fails, returns the content as a plain string.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        
    Returns:
        Content of the S3 object (parsed as JSON if possible, otherwise string)
    
    Raises:
        ValueError: If the object cannot be read from S3
    """
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read().decode('utf-8')
        
        # Try to parse as JSON
        try:
            return json.loads(content)
        except:
            # Return as string if not valid JSON
            return content
    except Exception as e:
        logger = logging.getLogger()
        logger.error(f"Error reading from S3: {str(e)}")
        raise ValueError(f"Could not read from S3: {str(e)}")

def write_to_s3(bucket: str, key: str, content: Union[Dict, List, str]) -> str:
    """
    Writes content to an S3 object. Automatically converts non-string content
    to JSON format with pretty-printing for better readability.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key where content will be stored
        content: Content to write (will be converted to JSON if not already a string)
        
    Returns:
        str: The content that was actually written to S3
    
    Raises:
        ValueError: If the content cannot be written to S3
    """
    try:
        # If content is already a string, use it directly
        if isinstance(content, str):
            body_content = content
        else:
            # Otherwise, convert to JSON string with indentation
            body_content = json.dumps(content, indent=2)
            
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body_content,
            ContentType='application/json'
        )
        
        return body_content
    except Exception as e:
        logger = logging.getLogger()
        logger.error(f"Error writing to S3: {str(e)}")
        raise ValueError(f"Could not write to S3: {str(e)}")

def write_audio_to_s3(bucket: str, key: str, audio_content: bytes) -> bool:
    """
    Writes binary audio content (MP3) to S3 with appropriate content type.
    Specifically designed for storing audio files generated by text-to-speech services.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key for the audio file
        audio_content: Binary audio content (MP3 format)
        
    Returns:
        bool: True if successful
    
    Raises:
        ValueError: If the audio content cannot be written to S3
    """
    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=audio_content,
            ContentType='audio/mpeg'
        )
        return True
    except Exception as e:
        logger = logging.getLogger()
        logger.error(f"Error writing audio to S3: {str(e)}")
        raise ValueError(f"Could not write audio to S3: {str(e)}")

def build_response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Creates a standardized API Gateway response with proper CORS headers
    to ensure the API can be called from web browsers across different domains.
    
    Args:
        status_code: HTTP status code for the response
        body: Response body data to be JSON-encoded
        
    Returns:
        dict: Properly formatted API Gateway response with CORS headers
    """
    return {
        'statusCode': status_code,
        'body': json.dumps(body),
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
            'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST'
        }
    }

def get_image_format(file_name: str) -> str:
    """
    Determines the image format from a file's extension for use with
    AI/ML services that require explicit format specification.
    
    Args:
        file_name: Name of the image file
        
    Returns:
        str: Image format ('jpeg', 'png', etc.) normalized for API use
    """
    if not file_name:
        return 'png'  # Default to png if no filename
    
    extension = file_name.lower().split('.')[-1]
    if extension in ['jpg', 'jpeg']:
        return 'jpeg'
    elif extension == 'png':
        return 'png'
    else:
        # Default to png if unknown
        logger = logging.getLogger()
        logger.warning(f"Unknown image format for {file_name}, defaulting to png")
        return 'png'

def call_bedrock_llm(
    model_id: str, 
    system_prompt: Union[str, List], 
    message_list: List[Dict[str, Any]]
) -> str:
    """
    Makes a standardized call to Amazon Bedrock large language models.
    Handles the API request formatting and response parsing for consistent
    interaction with various Bedrock models across the application.
    
    Args:
        model_id: Amazon Bedrock model identifier (e.g., 'amazon.nova-lite-v1:0')
        system_prompt: System prompt text or structured prompt list
        message_list: List of conversation messages for the LLM
        
    Returns:
        str: The text content extracted from the LLM response
        
    Raises:
        RuntimeError: If there's an error calling the Bedrock LLM
    """
    logger = logging.getLogger()
    
    try:
        # Prepare system list
        if isinstance(system_prompt, str):
            system_list = [{"text": system_prompt}]
        else:
            system_list = system_prompt
        
        # Prepare payload
        payload = {
            "messages": message_list,
            "system": system_list
        }
        
        logger.info(f"Calling Bedrock LLM model: {model_id}")
        
        # Invoke the model
        response = bedrock_client.invoke_model(
            modelId=model_id, 
            body=json.dumps(payload)
        )
        
        # Process the response
        response_body = json.loads(response['body'].read())
        logger.info(f"LLM response received successfully")
        
        # Extract the content
        content = response_body['output']['message']['content'][0]['text']
        logger.info(f"Extracted text content of length: {len(content)} characters")
        
        return content
        
    except Exception as e:
        logger.error(f"Error calling Bedrock LLM: {str(e)}")
        raise RuntimeError(f"Failed to call Bedrock LLM: {str(e)}")

"""
Audio utilities for processing and combining MP3 files.
These functions should be added to the CtiPathCulturaLens_CommonFunctions.py module.
"""

def chunk_text_by_paragraphs(text, max_chars=3000):
    """
    Intelligently splits text into chunks based on paragraph boundaries
    while respecting character limits. This is essential for text-to-speech
    services that have input length restrictions.
    
    Args:
        text (str): The text to split into manageable chunks
        max_chars (int): Maximum characters per chunk (default: 3000)
        
    Returns:
        list: List of text chunks, each under the character limit
    """
    if not text:
        return []
    
    # Split text into paragraphs
    paragraphs = text.split('\n\n')
    chunks = []
    current_chunk = ""
    
    for paragraph in paragraphs:
        # If paragraph itself exceeds max_chars, split it by sentences
        if len(paragraph) > max_chars:
            sentences = split_into_sentences(paragraph)
            for sentence in sentences:
                if len(current_chunk) + len(sentence) + 2 <= max_chars:
                    if current_chunk:
                        current_chunk += " " + sentence
                    else:
                        current_chunk = sentence
                else:
                    chunks.append(current_chunk)
                    current_chunk = sentence
        # Otherwise, add paragraph if it fits in current chunk
        elif len(current_chunk) + len(paragraph) + 4 <= max_chars:  # +4 for '\n\n'
            if current_chunk:
                current_chunk += "\n\n" + paragraph
            else:
                current_chunk = paragraph
        # If it doesn't fit, start a new chunk
        else:
            if current_chunk:
                chunks.append(current_chunk)
            current_chunk = paragraph
    
    # Add the last chunk if not empty
    if current_chunk:
        chunks.append(current_chunk)
    
    return chunks

def split_into_sentences(text):
    """
    Splits text into individual sentences using regex pattern matching.
    Handles most common sentence-ending punctuation marks.
    
    Args:
        text (str): Text to split into sentences
        
    Returns:
        list: List of individual sentences with empty strings removed
    """
    # Simple sentence splitting - handles most common cases
    import re
    sentence_endings = r'(?<=[.!?])\s+'
    sentences = re.split(sentence_endings, text)
    
    # Remove empty strings
    sentences = [s for s in sentences if s.strip()]
    
    return sentences

def concatenate_mp3_files(mp3_data_list):
    """
    Concatenates multiple MP3 binary data streams into a single MP3 file.
    This basic concatenation works well with Amazon Polly MP3 outputs
    for creating seamless audio from multiple text chunks.
    
    Args:
        mp3_data_list (list): List of MP3 binary data chunks to combine
        
    Returns:
        bytes: Combined MP3 data as a single binary stream
    """
    if not mp3_data_list:
        return None
    
    if len(mp3_data_list) == 1:
        return mp3_data_list[0]
    
    combined = bytearray()
    
    for i, data in enumerate(mp3_data_list):
        if i == 0:
            # Use the first file as is
            combined.extend(data)
        else:
            combined.extend(data)
    
    return bytes(combined)

def invoke_lambda_function(function_name, payload):
    """
    Invokes another Lambda function directly with comprehensive error handling
    and response processing. Enables communication between Lambda functions
    within the application architecture.
    
    Args:
        function_name: Name of the Lambda function to invoke
        payload: Data to send to the target Lambda function
        
    Returns:
        Parsed response from the invoked Lambda function
        
    Raises:
        Exception: If the Lambda invocation fails or returns an error
    """
    try:
        logger = logging.getLogger()
        lambda_client = boto3.client('lambda')
        
        # Log the payload for debugging
        logger.info(f"Invoking Lambda {function_name} with payload: {json.dumps(payload)}")
        
        response = lambda_client.invoke(
            FunctionName=function_name,
            InvocationType='RequestResponse',
            Payload=json.dumps(payload)
        )
        
        # Process the response
        if response['StatusCode'] >= 400:
            logger.error(f"Error invoking Lambda function {function_name}: {response}")
            raise Exception(f"Lambda invocation failed with status {response['StatusCode']}")
        
        # Read the payload
        response_payload = json.loads(response['Payload'].read().decode('utf-8'))
        
        # Check if the response is an error - has to be handled differently now that
        # we return direct objects for Lambda invocations
        if isinstance(response_payload, dict) and 'error' in response_payload:
            logger.error(f"Error response from Lambda {function_name}: {response_payload['error']}")
            raise Exception(f"{function_name} Lambda returned error: {response_payload['error']}")
        
        logger.info(f"Response received from Lambda {function_name}")
        # Don't log the full response if it contains large data like audio
        if isinstance(response_payload, dict) and 'audioData' in response_payload:
            audio_size = len(response_payload['audioData']) if response_payload['audioData'] else 0
            logger.info(f"Audio data received of size: {audio_size} bytes")
        else:
            logger.info(f"Response structure: {type(response_payload)}")
        
        return response_payload
        
    except Exception as e:
        logger.error(f"Error invoking Lambda function {function_name}: {str(e)}")
        raise