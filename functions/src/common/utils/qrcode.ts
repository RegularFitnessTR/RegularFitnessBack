import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a unique QR code string for coach identification
 */
export const generateQRCode = (): string => {
    return uuidv4();
};
