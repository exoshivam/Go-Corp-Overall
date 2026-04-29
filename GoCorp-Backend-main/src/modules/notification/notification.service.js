import nodemailer from 'nodemailer';
import { NotificationLog } from './notificationLog.model.js';
import { Office } from '../office/office.model.js';

let transporter;

const getTransporter = () => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER || 'dummy@gmail.com',
                pass: process.env.SMTP_PASS || 'dummypass',
            },
        });
    }
    return transporter;
};

export const sendLowBalanceEmail = async (adminEmails, currentBalance, officeId = null) => {
    try {
        const toList = Array.isArray(adminEmails) ? adminEmails.join(', ') : adminEmails;

        // Fetch office settings for priority if officeId is provided
        let priority = "HIGH"; // Default for low balance
        if (officeId) {
            const office = await Office.findById(officeId);
            if (office?.notification_settings?.low_balance_priority) {
                priority = office.notification_settings.low_balance_priority;
            }
            
            // Check if emails are enabled
            if (office?.notification_settings?.enable_emails === false) {
                console.log(`[NotificationService] Emails disabled for office ${officeId}. Skipping.`);
                return false;
            }
        }

        const mailOptions = {
            from: process.env.SMTP_FROM || '"Go-Corp Alerts" <alerts@gocorp.com>',
            to: toList,
            subject: '⚠️ Urgent: Office Wallet Balance Low',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #d32f2f; text-align: center;">Low Balance Alert</h2>
                    <p style="font-size: 16px; color: #333;">Hello,</p>
                    <p style="font-size: 16px; color: #333;">This is an automated alert to notify you that your office wallet balance has dropped below the minimum threshold of ₹2,000.</p>
                    <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0;">
                        <p style="margin: 0; font-size: 18px; color: #b71c1c; font-weight: bold;">Current Balance: ₹${currentBalance}</p>
                    </div>
                    <p style="font-size: 16px; color: #333;">Please recharge your wallet immediately to ensure uninterrupted ride booking services for your employees.</p>
                    <br/>
                    <p style="font-size: 14px; color: #777;">Best regards,</p>
                    <p style="font-size: 14px; color: #777; font-weight: bold;">Go-Corp Automated System</p>
                </div>
            `
        };

        const info = await getTransporter().sendMail(mailOptions);
        console.log(`[NotificationService] Low balance email sent successfully: ${info.messageId}`);

        // Log the notification
        if (officeId) {
            await NotificationLog.create({
                office_id: officeId,
                type: 'LOW_BALANCE',
                priority: priority,
                recipient: toList,
                content: `Low balance alert: ₹${currentBalance}`,
                status: 'SENT'
            });
        }

        return true;
    } catch (error) {
        console.error(`[NotificationService] Failed to send low balance email:`, error);
        
        // Log failure
        if (officeId) {
            try {
                await NotificationLog.create({
                    office_id: officeId,
                    type: 'LOW_BALANCE',
                    priority: 'HIGH',
                    recipient: Array.isArray(adminEmails) ? adminEmails.join(', ') : adminEmails,
                    content: `Low balance alert failure: ₹${currentBalance}`,
                    status: 'FAILED'
                });
            } catch (logError) {
                console.error(`[NotificationService] Failed to log failure:`, logError);
            }
        }

        return false;
    }
};
