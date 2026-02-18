import {
    TransactionPromise,
    TransactionResult,
    TransactionType
} from "@server/managers/transactionManager/transactionPromise";
import { PrivateApiAction } from ".";

export class PrivateApiContacts extends PrivateApiAction {
    tag = "PrivateApiContacts";

    async getHandlesContactInfo(includePhotos = false): Promise<TransactionResult> {
        const action = "get-handles-contact-info";
        const request = new TransactionPromise(TransactionType.CONTACT);
        return this.sendApiMessage(action, { includePhotos }, request);
    }

    async getContactForHandle(address: string): Promise<TransactionResult> {
        const action = "get-contact-for-handle";
        this.throwForNoMissingFields(action, [address]);
        const request = new TransactionPromise(TransactionType.CONTACT);
        return this.sendApiMessage(action, { address }, request);
    }

    async getContactPhoto(address: string, quality: "full" | "thumbnail" = "full"): Promise<TransactionResult> {
        const action = "get-contact-photo";
        this.throwForNoMissingFields(action, [address]);
        const request = new TransactionPromise(TransactionType.CONTACT);
        return this.sendApiMessage(action, { address, quality }, request);
    }

    async batchCheckIMessage(addresses: string[]): Promise<TransactionResult> {
        const action = "batch-check-imessage";
        this.throwForNoMissingFields(action, [addresses]);
        const request = new TransactionPromise(TransactionType.CONTACT);
        return this.sendApiMessage(action, { addresses }, request);
    }

    async getHandleSiblings(address: string): Promise<TransactionResult> {
        const action = "get-handle-siblings";
        this.throwForNoMissingFields(action, [address]);
        const request = new TransactionPromise(TransactionType.CONTACT);
        return this.sendApiMessage(action, { address }, request);
    }

    async getSuggestedNames(address?: string): Promise<TransactionResult> {
        const action = "get-suggested-names";
        const request = new TransactionPromise(TransactionType.CONTACT);
        return this.sendApiMessage(action, address ? { address } : {}, request);
    }

    async getContactAvailability(address: string): Promise<TransactionResult> {
        const action = "get-contact-availability";
        this.throwForNoMissingFields(action, [address]);
        const request = new TransactionPromise(TransactionType.CONTACT);
        return this.sendApiMessage(action, { address }, request);
    }

    async detectBusinessContact(address: string): Promise<TransactionResult> {
        const action = "detect-business-contact";
        this.throwForNoMissingFields(action, [address]);
        const request = new TransactionPromise(TransactionType.CONTACT);
        return this.sendApiMessage(action, { address }, request);
    }
}
