export interface HandleContactInfo {
    handleId: string;
    service: string;
    fullName: string | null;
    isContact: boolean;
    isBusiness: boolean;
    personCentricID: string | null;
    cnContactID: string | null;
    suggestedName: string | null;
    photoBase64?: string | null;
    siblings: HandleSibling[];
}

export interface ContactDetail {
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
    nickname: string | null;
    isContact: boolean;
    isBusiness: boolean;
    personCentricID: string | null;
    cnContactID: string | null;
    isInAddressBook: boolean;
    allAddresses: string[];
}

export interface ContactPhoto {
    address: string;
    photoData: string | null;
    quality: "full" | "thumbnail";
}

export type BatchIMessageStatus = Record<string, number>;

export interface HandleSibling {
    handleId: string;
    service: string;
}

export interface SuggestedName {
    handleId: string;
    suggestedName: string;
}

export interface ContactAvailability {
    availability: number;
    availabilityDescription: string;
}

export interface BusinessContactInfo {
    address: string;
    isBusiness: boolean;
    isMako: boolean;
    isApple: boolean;
    businessName: string | null;
}
