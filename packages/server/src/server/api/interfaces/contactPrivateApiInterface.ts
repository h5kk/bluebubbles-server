import { Server } from "@server";
import { checkPrivateApiStatus } from "@server/helpers/utils";
import { Forbidden } from "@server/api/http/api/v1/responses/errors";

export class ContactPrivateApiInterface {
    private static checkFeatureFlag() {
        const enabled = Server().repo.getConfig("enable_contacts_private_api") as boolean;
        if (!enabled) {
            throw new Forbidden({
                error: "Contact Private API is not enabled! Enable it in the server settings."
            });
        }
    }

    private static extractData(result: any, fallback: any = null) {
        const payload = result?.data;
        // readTransactionData may double-wrap when the helper's data field is empty
        // (e.g. {data: []} instead of []), so try payload.data first
        if (payload && typeof payload === "object" && !Array.isArray(payload) && "data" in payload) {
            return payload.data ?? fallback;
        }
        return payload ?? fallback;
    }

    static async getHandlesContactInfo(includePhotos = false) {
        this.checkFeatureFlag();
        checkPrivateApiStatus();
        const result = await Server().privateApi.contacts.getHandlesContactInfo(includePhotos);
        return ContactPrivateApiInterface.extractData(result, []);
    }

    static async getContactForHandle(address: string) {
        this.checkFeatureFlag();
        checkPrivateApiStatus();
        const result = await Server().privateApi.contacts.getContactForHandle(address);
        return ContactPrivateApiInterface.extractData(result);
    }

    static async getContactPhoto(address: string, quality: "full" | "thumbnail" = "full") {
        this.checkFeatureFlag();
        checkPrivateApiStatus();
        const result = await Server().privateApi.contacts.getContactPhoto(address, quality);
        return ContactPrivateApiInterface.extractData(result);
    }

    static async batchCheckIMessage(addresses: string[]) {
        this.checkFeatureFlag();
        checkPrivateApiStatus();
        const result = await Server().privateApi.contacts.batchCheckIMessage(addresses);
        return ContactPrivateApiInterface.extractData(result, {});
    }

    static async getHandleSiblings(address: string) {
        this.checkFeatureFlag();
        checkPrivateApiStatus();
        const result = await Server().privateApi.contacts.getHandleSiblings(address);
        return ContactPrivateApiInterface.extractData(result);
    }

    static async getSuggestedNames(address?: string) {
        this.checkFeatureFlag();
        checkPrivateApiStatus();
        const result = await Server().privateApi.contacts.getSuggestedNames(address);
        return ContactPrivateApiInterface.extractData(result, []);
    }

    static async getContactAvailability(address: string) {
        this.checkFeatureFlag();
        checkPrivateApiStatus();
        const result = await Server().privateApi.contacts.getContactAvailability(address);
        return ContactPrivateApiInterface.extractData(result);
    }

    static async detectBusinessContact(address: string) {
        this.checkFeatureFlag();
        checkPrivateApiStatus();
        const result = await Server().privateApi.contacts.detectBusinessContact(address);
        return ContactPrivateApiInterface.extractData(result);
    }
}
