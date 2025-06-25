# CulturaLens

A revolutionary AI-powered cultural artifact exploration platform that transforms how we discover and understand cultural heritage through immersive storytelling.

## 🌍 Overview

CulturaLens uses advanced AI technology to analyze cultural artifacts from images and generate engaging, culturally-aware stories that bring history to life. By combining computer vision, natural language processing, and text-to-speech capabilities, the platform creates personalized educational experiences that respect and celebrate diverse cultural perspectives.

## ✨ Key Features

### 🔍 **AI-Powered Artifact Analysis**
- **Smart Image Recognition**: Upload photos of cultural artifacts, artworks, or historical objects
- **Comprehensive Analysis**: Generates detailed descriptions, historical context, and cultural significance
- **Multi-Cultural Perspectives**: Provides viewpoints from different cultural backgrounds and time periods

### 📖 **Dynamic Storytelling**
- **Immersive Narratives**: Creates engaging stories that place artifacts in real-world cultural contexts
- **Character-Driven Content**: Features authentic characters and dialogue appropriate to each cultural perspective
- **Educational Focus**: Content tailored to different age groups and learning preferences

### 🎵 **Advanced Audio Features**
- **Multi-Voice Support**: Choose from various AI voices or use system text-to-speech
- **Audio Generation**: Automatic creation of high-quality MP3 narrations
- **Smart Streaming**: Progressive audio loading for immediate playback
- **Cross-Platform Download**: Audio files compatible with all devices

### 🎨 **Personalized Experience**
- **Cultural Preferences**: Customize stories based on age, gender, and language preferences
- **Multi-Language Support**: Available in 11 languages including English, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Korean, and Arabic
- **Adaptive Content**: Stories adjust complexity and tone based on user preferences

### 🖼️ **Image Management**
- **Smart Upload**: Support for PNG, JPG, and JPEG formats with automatic validation
- **Image Enhancement**: Built-in rotation tools for proper artifact orientation
- **Gallery View**: Organized collection of analyzed artifacts with metadata
- **Cloud Storage**: Secure AWS S3 integration with CloudFront CDN for fast loading

### 🔒 **Security & Privacy**
- **AWS Cognito Authentication**: Secure user authentication and authorization
- **Identity-Based Access**: Users can only access their own artifacts and stories
- **Encrypted Storage**: All user data encrypted in transit and at rest
- **Privacy-First Design**: No tracking of personal information beyond preferences

## 🏗️ Architecture

### Frontend (React TypeScript)
- **Modern React**: Built with React 18, TypeScript, and modern hooks
- **Responsive Design**: Mobile-first design with Tailwind CSS
- **Progressive Web App**: Optimized for both desktop and mobile experiences
- **Real-time Updates**: Live progress tracking for audio generation and processing

### Backend (AWS Serverless)
- **AWS Lambda Functions**: AI processing and audio generation
    1. Create descriptions of uploaded images using AI
    2. Create stories of the uploaded images in parallel based on 3 different cultural preferences using AI
    3. Create audio files of stories using Amazon Polly
    4. Update user preferences to DynamoDB
- **Amazon S3**: Secure file storage with intelligent path organization
- **AWS Systems Manager**: Centralized configuration management
- **Amazon Bedrock**: Advanced AI model for image analysis and story generation
- **Amazon Polly**: Neural and standard voice synthesis engines

### AI/ML Components
- **Computer Vision**: Amazon Bedrock Nova for artifact recognition and analysis
- **Natural Language Generation**: Context-aware story creation with cultural sensitivity
- **Text-to-Speech**: Amazon Polly with voice selection and quality optimization
- **Parallel Processing**: Multi-threaded story generation for optimal performance

## 📱 Usage

### Basic Workflow

1. **Upload an Artifact**
   - Take a photo or upload an image of a cultural artifact
   - Use rotation tools to orient the image correctly
   - Click "Process Image" to begin AI analysis

2. **Review Analysis**
   - Read the generated description and historical context
   - Explore different cultural perspectives on the artifact
   - Adjust preferences for personalized storytelling

3. **Generate Stories**
   - Set your preferred age group, gender, and language
   - Choose voice preferences for audio narration
   - Click "Create Stories" to generate cultural narratives

4. **Enjoy Content**
   - Read immersive stories from different cultural viewpoints
   - Listen to high-quality audio narrations
   - Save and share your favorite discoveries

### Advanced Features

- **Gallery Management**: Browse all your analyzed artifacts
- **Audio Controls**: Play, pause, download, and manage audio files
- **Preference Profiles**: Save preferences for consistent experiences
- **Cross-Device Sync**: Access your content from any device

## 🌐 Internationalization

CulturaLens supports 11 languages with:
- Complete UI translation using react-i18next
- Cultural context-aware content generation
- Language-specific voice selection
- Regional preference handling

Supported languages: English, Spanish, French, German, Italian, Portuguese, Russian, Chinese (Simplified), Japanese, Korean, Arabic

## 🔊 Audio System

### Voice Options
- **System Voice**: Browser-native text-to-speech (free, immediate)
- **Premium Voices**: Amazon Polly neural and standard engines
- **Voice Preview**: Test voices before selection
- **Smart Engine Selection**: Automatic neural/standard engine choice

### Audio Features
- **Chunk Processing**: Large stories split for optimal processing
- **Seamless Playback**: Chunks concatenated for smooth listening
- **Download Support**: Cross-platform audio file downloads
- **Real-time Generation**: Progressive audio creation with live updates

## 🛡️ Security Features

- **Input Validation**: Comprehensive sanitization of all user inputs
- **Path Traversal Protection**: Secure S3 key generation
- **Identity Isolation**: Users can only access their own content
- **Secure Headers**: CORS and security headers properly configured
- **Error Handling**: Graceful degradation without exposing system details

## 🔄 API Integration

### AWS Services Integration
- **Amazon Bedrock**: AI model integration for image analysis
- **Amazon Polly**: Text-to-speech with multiple voice options
- **AWS Lambda**: Serverless function execution
- **Amazon S3**: Secure file storage and retrieval
- **AWS Systems Manager**: Configuration parameter management

### Error Handling
- Comprehensive error boundaries and fallback mechanisms
- User-friendly error messages with actionable guidance
- Automatic retry logic for transient failures
- Graceful degradation when services are unavailable

## 📊 Monitoring & Analytics

- CloudWatch integration for Lambda function monitoring
- Performance metrics tracking for optimization
- Error rate monitoring and alerting
- User interaction analytics (privacy-compliant)

**CulturaLens** - Bringing cultural heritage to life through AI-powered storytelling.
