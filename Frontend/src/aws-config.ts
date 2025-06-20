import { Amplify } from 'aws-amplify';

export const configureAmplify = () => {
  Amplify.configure({
    Auth: {
      region: process.env.REACT_APP_REGION,
      userPoolId: process.env.REACT_APP_USER_POOL_ID,
      userPoolWebClientId: process.env.REACT_APP_USER_POOL_WEB_CLIENT_ID,
      identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID, 
      mandatorySignIn: true,
    },
    Storage: {
      AWSS3: {
        bucket: process.env.REACT_APP_S3_BUCKET,
        region: process.env.REACT_APP_REGION,
        level: 'public',
        customPrefix: {
          public: 'public/',
          private: 'private/',
        },
        // Disable S3 Accelerate endpoint
        useAccelerateEndpoint: false,
        
        // CloudFront 
        cloudFrontDomainName: process.env.REACT_APP_S3_URL ? 
          process.env.REACT_APP_S3_URL.replace(/^https?:\/\//, '').replace(/\/$/, '') : 
          undefined,
      }
    },    
    API: {
      endpoints: [
        {
          name: 'culturalensApi',
          endpoint: process.env.REACT_APP_API_ENDPOINT,
          region: process.env.REACT_APP_REGION,
        },
      ]
    }
  });
};