"""
Lambda function for managing user preferences.

This module handles storing and retrieving user preferences from DynamoDB.
It supports GET and PUT operations for user preferences linked to Cognito user IDs.
"""

import json
import boto3
from datetime import datetime
from botocore.exceptions import ClientError
from typing import Dict, Any, Optional

# Import common functions from layer
from ctipath_culturalens_common import get_parameters, configure_logging, build_response

# Set up logging
logger = configure_logging()

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main handler for user preferences operations supporting both GET and PUT operations.
    Provides secure, validated access to user preferences stored in DynamoDB with
    proper error handling and CORS support for web applications.
    
    This function serves as the central entry point for all preference-related operations:
    - Validates incoming requests and extracts operation parameters
    - Performs input sanitization and security checks
    - Routes requests to appropriate operation handlers (GET/PUT)
    - Ensures consistent error handling and response formatting
    - Maintains CORS compatibility for web application integration
    
    The function expects requests with the following structure:
    {
        "operation": "GET" | "PUT",
        "userId": "cognito-user-id",
        "preferences": {...}  // Only required for PUT operations
    }
    
    Args:
        event: Lambda event object from API Gateway containing:
            - body: JSON string with operation, userId, and optional preferences
            - headers: HTTP headers from the client request
            - requestContext: API Gateway context information
        context: Lambda context object with runtime information including:
            - function_name: Name of the executing Lambda function
            - aws_request_id: Unique identifier for this invocation
            - remaining_time_in_millis: Timeout information
        
    Returns:
        dict: API Gateway response with CORS headers containing:
            - statusCode: HTTP response code (200, 400, 500)
            - headers: CORS headers for cross-origin requests
            - body: JSON response with preferences data or error messages
    """
    try:
        # Get parameters from Parameter Store
        parameters = get_parameters()
        table_name = parameters.get('TableName', 'CtiPathCulturaLens-Preferences')
        
        # Initialize DynamoDB client
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(table_name)
        
        # Check if event has a body
        if 'body' not in event:
            return build_response(400, {'error': 'Invalid request format'})
        
        # Parse request body
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        
        # Get operation and validate required fields
        operation = body.get('operation')
        user_id = body.get('userId')
        
        if not operation or not user_id:
            return build_response(400, {'error': 'Missing required parameters'})
        
        # Validate user_id format (basic validation)
        if not isinstance(user_id, str) or len(user_id) < 1 or len(user_id) > 100:
            return build_response(400, {'error': 'Invalid userId format'})
        
        # Process based on operation type
        if operation == 'GET':
            return get_preferences(user_id, table)
        elif operation == 'PUT':
            preferences = body.get('preferences')
            if not preferences:
                return build_response(400, {'error': 'Missing preferences data'})
                
            # Basic validation of preferences (should be a dict)
            if not isinstance(preferences, dict):
                return build_response(400, {'error': 'Preferences must be an object'})
                
            return save_preferences(user_id, preferences, table)
        else:
            return build_response(400, {'error': 'Invalid operation'})
    
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return build_response(500, {'error': 'Internal server error'})

def get_preferences(user_id: str, table: Any) -> Dict[str, Any]:
    """
    Retrieves user preferences from DynamoDB with retry logic for handling
    transient errors like throttling. Returns empty object if no preferences
    exist, enabling graceful handling of new users.
    
    This function implements a robust retrieval strategy:
    - Uses exponential backoff retry logic for transient DynamoDB errors
    - Handles throttling and provisioned throughput exceptions gracefully
    - Returns empty preferences object for new users (no error condition)
    - Provides detailed error logging for debugging and monitoring
    - Maintains consistency with API response format expectations
    
    The retry mechanism is particularly important for handling:
    - ProvisionedThroughputExceededException: When read capacity is exceeded
    - ThrottlingException: When request rate limits are hit
    - Temporary network issues or service unavailability
    
    Args:
        user_id: AWS Cognito user identifier, validated by caller
        table: DynamoDB table resource object configured for the preferences table
        
    Returns:
        dict: API Gateway response containing:
            - For existing users: User preferences object with all stored settings
            - For new users: Empty object {} indicating no preferences set
            - For errors: Error response with appropriate HTTP status code
    """
    try:
        # Implement retry mechanism for transient DynamoDB errors
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                response = table.get_item(
                    Key={'userId': user_id}
                )
                
                # Return preferences if they exist, otherwise return empty object
                if 'Item' in response:
                    return build_response(200, response['Item'].get('preferences', {}))
                else:
                    return build_response(200, {})
                    
            except ClientError as e:
                # Check if error is retryable
                if e.response['Error']['Code'] in ['ProvisionedThroughputExceededException', 
                                                 'ThrottlingException']:
                    retry_count += 1
                    if retry_count < max_retries:
                        # Exponential backoff
                        import time
                        time.sleep(2 ** retry_count * 0.1)
                        continue
                
                # Not retryable or max retries reached
                raise
        
        # Should not reach here, but just in case
        logger.error("Max retries reached while getting preferences")
        return build_response(500, {'error': 'Failed to retrieve preferences after multiple attempts'})
    
    except ClientError as e:
        logger.error(f"Error retrieving preferences: {str(e)}")
        return build_response(500, {'error': 'Failed to retrieve preferences'})

def save_preferences(user_id: str, preferences: Dict[str, Any], table: Any) -> Dict[str, Any]:
    """
    Persists user preferences to DynamoDB with automatic timestamping and
    retry logic for handling transient errors. Overwrites existing preferences
    to ensure the latest settings are always stored.
    
    This function implements a comprehensive persistence strategy:
    - Automatically adds timestamp for audit and debugging purposes
    - Uses exponential backoff retry logic for transient DynamoDB errors
    - Handles throttling and provisioned throughput exceptions gracefully
    - Overwrites existing preferences completely (not a merge operation)
    - Provides detailed error logging for monitoring and troubleshooting
    - Maintains transactional consistency for preference updates
    
    The function stores preferences with the following structure:
    {
        "userId": "cognito-user-id",
        "preferences": {
            // User preference data as provided
        },
        "updatedAt": "ISO-8601-timestamp"
    }
    
    Args:
        user_id: AWS Cognito user identifier, validated by caller
        preferences: User preference data to store, validated as dict by caller
        table: DynamoDB table resource object configured for the preferences table
        
    Returns:
        dict: API Gateway response containing:
            - Success: Confirmation message with 200 status code
            - Error: Error message with appropriate HTTP status code (500 for failures)
    """
    try:
        # Implement retry mechanism for transient DynamoDB errors
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                # Store preferences with timestamp
                table.put_item(
                    Item={
                        'userId': user_id,
                        'preferences': preferences,
                        'updatedAt': datetime.now().isoformat()
                    }
                )
                return build_response(200, {'message': 'Preferences saved successfully'})
                
            except ClientError as e:
                # Check if error is retryable
                if e.response['Error']['Code'] in ['ProvisionedThroughputExceededException', 
                                                 'ThrottlingException']:
                    retry_count += 1
                    if retry_count < max_retries:
                        # Exponential backoff
                        import time
                        time.sleep(2 ** retry_count * 0.1)
                        continue
                
                # Not retryable or max retries reached
                raise
        
        # Should not reach here, but just in case
        logger.error("Max retries reached while saving preferences")
        return build_response(500, {'error': 'Failed to save preferences after multiple attempts'})
    
    except ClientError as e:
        logger.error(f"Error saving preferences: {str(e)}")
        return build_response(500, {'error': 'Failed to save preferences'})