import { DynamoDBStreamEvent } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});

export const handler = async (event: DynamoDBStreamEvent) => {
  const record = event.Records[0];
  
  // Only process new items
  if (record.eventName !== 'INSERT') {
    return;
  }

  const newImage = record.dynamodb?.NewImage;
  if (!newImage) {
    return;
  }

  try {
    const fileExtension = newImage.fileExtension.S;
    const fileSize = newImage.fileSize.N;
    const uploadDate = newImage.uploadDate.S;

    // Send email notification
    await ses.send(new SendEmailCommand({
      Source: 'your-verified-email@domain.com', // Replace with your verified SES email
      Destination: {
        ToAddresses: [process.env.CLIENT_EMAIL!],
      },
      Message: {
        Subject: {
          Data: 'File Upload Notification',
        },
        Body: {
          Text: {
            Data: `
              A new file has been processed:
              - File Extension: ${fileExtension}
              - File Size: ${fileSize} bytes
              - Upload Date: ${uploadDate}
            `,
          },
        },
      },
    }));

  } catch (error) {
    console.error('Error sending email notification:', error);
    throw error;
  }
};