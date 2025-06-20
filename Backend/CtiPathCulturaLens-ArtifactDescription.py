"""
Lambda function for generating cultural descriptions of artifacts based on image analysis.

This module analyzes uploaded images using Amazon Bedrock (Nova) to generate
cultural information, including title, description, historical context, and cultural views.
"""

import json
import boto3
import time
import re
from typing import Dict, List, Any, Optional, Tuple, Union

# Import common functions from layer
from ctipath_culturalens_common import (
    get_parameters, configure_logging,
    extract_image_content, get_image_format, call_bedrock_llm,
    sanitize_path_component
)

# Set up logging
logger = configure_logging()

# Initialize AWS clients
s3_client = boto3.client('s3')
bedrock_client = boto3.client('bedrock-runtime')

# JSON metadata file name
METADATA_FILE = "artifact_description.json"

def clean_llm_json_response(content: str) -> Dict[str, Any]:
    """
    Cleans and parses JSON responses from Large Language Models that may contain
    markdown formatting, code blocks, or other non-JSON elements. Implements
    multiple parsing strategies with fallbacks to ensure robust JSON extraction.
    
    This function handles common LLM response formats including:
    - Plain JSON responses
    - JSON wrapped in markdown code blocks (```json ... ```)
    - JSON objects embedded in explanatory text
    - Malformed JSON with common issues (single quotes, unquoted keys)
    
    Args:
        content: Raw text content from LLM that should contain JSON
        
    Returns:
        dict: Parsed JSON data with fallback error structure if parsing fails
    """
    # First, check if the content is already valid JSON
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Not valid JSON, continue with cleaning
        pass
    
    # Try to extract JSON from markdown code blocks (```json ... ```)
    code_block_pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
    code_match = re.search(code_block_pattern, content)
    if code_match:
        json_str = code_match.group(1).strip()
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            # Not valid JSON, continue with cleaning
            pass
    
    # Try to find any JSON-like object in the content
    json_object_pattern = r'({[\s\S]*?})'
    object_match = re.search(json_object_pattern, content)
    if object_match:
        json_str = object_match.group(1).strip()
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            # Try fixing common JSON issues (unquoted keys, single quotes instead of double quotes)
            try:
                # Replace single quotes with double quotes (but not within already double-quoted strings)
                # This is a simplistic approach and may not handle all edge cases
                fixed_json = re.sub(r"(?<!\\)'([^']*?)(?<!\\)'", r'"\1"', json_str)
                # Add quotes around unquoted keys
                fixed_json = re.sub(r'([{,])\s*([a-zA-Z0-9_]+):', r'\1"\2":', fixed_json)
                return json.loads(fixed_json)
            except json.JSONDecodeError:
                # Still not valid JSON, give up
                pass
    
    # If all parsing attempts fail, return a default object
    logger.error(f"All JSON parsing attempts failed for content: {content[:100]}...")
    return {
        "title": "Error: Could not parse response",
        "description": "The image was processed, but there was an error parsing the analysis.",
        "historical_description": "",
        "cultural_description": "",
        "cultural_views": []
    }

def generate_image_metadata(image_base64: str, file_name: str) -> Dict[str, Any]:
    """
    Generates comprehensive cultural metadata for an image using Amazon Bedrock's Nova model.
    Creates structured analysis including title, description, historical context, and
    multiple cultural perspectives on the artifact shown in the image.
    
    The function constructs a detailed prompt that instructs the AI to:
    - Identify or generate an appropriate title for the artifact
    - Provide a visual description of the image
    - Generate historical context with time periods and locations
    - Create cultural descriptions explaining the artifact's cultural significance
    - Develop multiple cultural viewpoints from different historical perspectives
    
    Args:
        image_base64: Base64-encoded image content for AI analysis
        file_name: Original file name which may provide additional context
        
    Returns:
        dict: Comprehensive metadata including:
            - title: Artifact name or generated title
            - description: Visual description of the image
            - historical_description: Historical context and background
            - cultural_description: Cultural significance explanation
            - cultural_views: Array of different cultural perspectives
        
    Raises:
        RuntimeError: If image metadata generation fails
    """
    try:
        # Get parameters from Parameter Store
        parameters = get_parameters()
        nova_model_id = parameters.get('NovaModelId', 'amazon.nova-lite-v1:0')
        
        # Determine image format from file name
        image_format = get_image_format(file_name)
        
        # Build structured prompt for Nova
        system_prompt = parameters.get('ArtifactDescriptionSystemPrompt')

        # Define a "user" message including both the image and a text prompt.
        message_list = [
            {
                "role": "user",
                "content": [
                    {
                        "image": {
                            "format": image_format,
                            "source": {"bytes": image_base64},
                        }
                    },
                    {
                        "text": f"Image filename: {file_name}"
                    }
                ],
            }
        ]

        # Call Bedrock LLM using the common function
        content = call_bedrock_llm(nova_model_id, system_prompt, message_list)
        logger.info(f"Received content from LLM for artifact description")
        
        # Try to extract JSON from the response using the clean_llm_json_response function
        metadata = clean_llm_json_response(content)
        
        # Ensure the metadata has the required fields
        required_fields = ["title", "description", "historical_description", "cultural_description"]
        missing_fields = [field for field in required_fields if field not in metadata]
        if missing_fields:
            logger.warning(f"API response missing fields: {missing_fields}")
            # Add missing fields with empty strings
            for field in missing_fields:
                metadata[field] = ""
                
        # Ensure cultural_views is properly handled (even if it's missing)
        if "cultural_views" not in metadata:
            logger.warning("cultural_views field missing in response, adding empty array")
            metadata["cultural_views"] = []
        else:
            # Validate that cultural_views is an array
            if not isinstance(metadata["cultural_views"], list):
                logger.warning("cultural_views is not an array, converting to empty array")
                metadata["cultural_views"] = []
            else:
                # Validate each item in the cultural_views array
                valid_views = []
                for i, view in enumerate(metadata["cultural_views"]):
                    # Check if the view has the required structure
                    if not isinstance(view, dict):
                        logger.warning(f"Item {i} in cultural_views is not an object, skipping")
                        continue
                        
                    # Check for required fields in each cultural view
                    if "culture" not in view or "view" not in view:
                        logger.warning(f"Item {i} in cultural_views missing required fields, adding defaults")
                        # Add missing fields with defaults
                        if "culture" not in view:
                            view["culture"] = "Unknown Culture"
                        if "view" not in view:
                            view["view"] = "No view description provided"
                    
                    valid_views.append(view)
                
                # Replace with validated views
                metadata["cultural_views"] = valid_views
                logger.info(f"Processed {len(valid_views)} valid cultural views")
            
        return metadata
    
    except Exception as e:
        logger.error(f"Error generating image metadata: {str(e)}")
        return {
            "title": "Error: Could not analyze image",
            "description": f"Error analyzing image: {str(e)}",
            "historical_description": "",
            "cultural_description": "",
            "cultural_views": []
        }

def extract_object_components(object_key: str) -> Dict[str, str]:
    """
    Parses an S3 object key to extract user ID, artifact UUID, and filename components.
    Handles various path formats and provides sensible defaults for missing components.
    
    This function supports multiple S3 key formats:
    - user/uuid/filename (full path)
    - user/filename (missing UUID)
    - filename (only filename provided)
    
    Args:
        object_key: S3 object key in format user/uuid/image_filename
        
    Returns:
        dict: Dictionary containing extracted components:
            - user_id: User identifier from path
            - uuid: Artifact UUID from path
            - filename: Image filename
    """
    components = object_key.split('/')
    
    # Initialize with default values
    user_id = ""
    uuid = ""
    filename = ""
    
    if len(components) >= 3:
        # Format is user/uuid/filename
        user_id = components[0]
        uuid = components[1]
        filename = components[2]
    elif len(components) == 2:
        # Format might be user/filename
        user_id = components[0]
        filename = components[1]
    elif len(components) == 1:
        # Just filename
        filename = components[0]
    
    logger.info(f"Extracted components - user: {user_id}, uuid: {uuid}, filename: {filename}")
    
    return {
        "user_id": user_id,
        "uuid": uuid,
        "filename": filename
    }

def get_directory_path(key: str) -> str:
    """
    Extracts the directory path from an S3 object key by finding the last slash
    and returning everything before it. Used for organizing related files in the same directory.
    
    Args:
        key: Complete S3 object key
        
    Returns:
        str: Directory path with trailing slash, or empty string if no directory structure
    """
    last_slash_index = key.rfind('/')
    if last_slash_index == -1:
        return ""  # Object is in root of bucket
    return key[:last_slash_index + 1]

def write_metadata_file(
    bucket: str, 
    directory_path: str, 
    object_key: str, 
    metadata: Dict[str, Any], 
    user_id: str, 
    artifact_id: str, 
    identity_id: str
) -> List[Dict[str, Any]]:
    """
    Creates a comprehensive metadata file for an artifact by combining the generated
    metadata with identifying information. Overwrites any existing metadata file
    to ensure the latest analysis is preserved.
    
    The metadata file contains:
    - Object identification (S3 key, user IDs, artifact ID)
    - Processing timestamp
    - File type classification
    - Complete cultural analysis results
    
    Args:
        bucket: S3 bucket name for storage
        directory_path: Directory path where metadata file will be stored
        object_key: Original S3 object key of the analyzed image
        metadata: Generated metadata from image analysis
        user_id: Application user identifier
        artifact_id: Unique artifact identifier
        identity_id: AWS Cognito identity ID
        
    Returns:
        list: Metadata array containing the single artifact entry for API response
        
    Raises:
        RuntimeError: If metadata cannot be written to S3
    """
    metadata_key = f"{directory_path}{METADATA_FILE}"
    
    # Extract filename from object_key
    filename = object_key.split('/')[-1] if '/' in object_key else object_key
    
    # Create metadata array with a single item
    metadata_array = [{
        "object": object_key,
        "identityid": identity_id,
        "userid": user_id,
        "artifactid": artifact_id,
        "filename": filename,
        "title": metadata.get("title", ""),
        "processed_timestamp": metadata.get("processed_timestamp", 0),
        "file_type": metadata.get("file_type", ""),
        "description": metadata.get("description", ""),
        "historical_description": metadata.get("historical_description", ""),
        "cultural_description": metadata.get("cultural_description", ""),
        "cultural_views": metadata.get("cultural_views", [])
    }]
    
    # Write metadata to S3, overwriting any existing file
    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=metadata_key,
            Body=json.dumps(metadata_array, indent=2),
            ContentType='application/json'
        )
        logger.info(f"Created/overwritten metadata file: {metadata_key}")
        
        # Return the metadata array for the API response
        return metadata_array
    except Exception as e:
        logger.error(f"Error writing metadata file: {str(e)}")
        raise RuntimeError(f"Failed to write metadata: {str(e)}")

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler function for processing artifact images via API Gateway.
    Orchestrates the entire image analysis workflow: validates input, extracts images,
    generates cultural metadata, and stores results in S3.
    
    The function performs the following workflow:
    1. Validates and extracts request parameters from API Gateway event
    2. Constructs proper S3 paths for image location
    3. Retrieves and processes the image from S3
    4. Generates comprehensive cultural metadata using AI analysis
    5. Stores metadata results in S3 for future retrieval
    6. Returns processed metadata in API Gateway response format
    
    Args:
        event: Lambda event object from API Gateway containing:
            - body: JSON with s3Path, userId, artifactId, identityId
        context: Lambda context object with runtime information
        
    Returns:
        dict: API Gateway response with CORS headers containing:
            - statusCode: HTTP response code (200 for success, 4xx/5xx for errors)
            - headers: CORS headers for web application compatibility
            - body: JSON response with processing results or error messages
    """
    try:
        # Get parameters from Parameter Store
        parameters = get_parameters()
        s3_bucket = parameters.get('S3Bucket', 'ctipath-culturalens')
        
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Extract request body from API Gateway event
        if 'body' in event:
            if isinstance(event['body'], str):
                body = json.loads(event['body'])
            else:
                body = event['body']
        else:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'  # For CORS support
                },
                'body': json.dumps({'error': 'Missing request body'})
            }
        
        # Extract parameters from request body
        s3_path = body.get('s3Path')
        user_id = body.get('userId')
        artifact_id = body.get('artifactId')
        identity_id = body.get('identityId')
        logger.info(f"Extracted parameters - s3Path: {s3_path}, userId: {user_id}, artifactId: {artifact_id}, identityId: {identity_id}")
        
        # Validate required parameters
        if not s3_path:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({'error': 'Missing s3Path parameter'})
            }
        
        if not identity_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({'error': 'Missing identityId parameter'})
            }
        
        # Sanitize inputs
        identity_id_safe = sanitize_path_component(identity_id)
        s3_path_safe = s3_path  # Keep original path but validate it
        
        # Validate s3_path format (simple check)
        if not re.match(r'^[a-zA-Z0-9_\-\.\/]+$', s3_path):
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({'error': 'Invalid s3Path format'})
            }
        
        # Note: s3_path already starts with userId according to the requirement
        if s3_path.startswith(f"{user_id}/"):
            # Extract components from the path
            path_components = s3_path.split('/')
            if len(path_components) >= 3:
                # Format is userId/artifactId/filename
                # Just ensure the correct path is constructed
                key = f"public/{s3_path}"
            else:
                # If it's just userId/filename, add the artifactId
                key = f"public/{user_id}/{artifact_id}/{path_components[1]}"
        else:
            # If s3_path is just a filename, construct the full path
            key = f"public/{user_id}/{artifact_id}/{s3_path}"

        logger.info(f"Constructed S3 key: {key}")
        
        logger.info(f"Processing image: {s3_bucket}/{key}")
        
        # Get directory path for metadata file
        directory_path = get_directory_path(key)
        
        # Process image
        file_name = key.split('/')[-1] if '/' in key else key
        base64_image = extract_image_content(s3_bucket, key)
        metadata = generate_image_metadata(base64_image, file_name)
        
        # Add timestamp and file info to metadata
        metadata["processed_timestamp"] = int(time.time())
        metadata["file_type"] = "image"
        
        # Write metadata file and get the metadata array for response
        metadata_array = write_metadata_file(s3_bucket, directory_path, key, metadata, user_id, artifact_id, identity_id_safe)
        
        # Return success response with metadata
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'  # For CORS support
            },
            'body': json.dumps({
                'message': 'Image processing completed successfully',
                'data': {
                    'metadata': metadata_array[0]  # Return the first (and only) item in the array
                }
            })
        }
    
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': f'Error processing image: {str(e)}'
            })
        }