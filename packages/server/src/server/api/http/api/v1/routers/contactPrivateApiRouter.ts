import { Next } from "koa";
import { RouterContext } from "koa-router";
import { Success } from "../responses/success";
import { BadRequest, ServerError } from "../responses/errors";
import { ContactPrivateApiInterface } from "@server/api/interfaces/contactPrivateApiInterface";

export class ContactPrivateApiRouter {
    static async getHandles(ctx: RouterContext, _: Next) {
        try {
            const includePhotos = ctx.request.query?.includePhotos === "true";
            const data = await ContactPrivateApiInterface.getHandlesContactInfo(includePhotos);
            return new Success(ctx, {
                message: "Successfully fetched handle contact info!",
                data
            }).send();
        } catch (ex: any) {
            if (ex.status) throw ex;
            throw new ServerError({
                message: "Failed to fetch handle contact info!",
                error: ex?.message ?? ex.toString()
            });
        }
    }

    static async getContact(ctx: RouterContext, _: Next) {
        try {
            const { address } = ctx.params;
            const data = await ContactPrivateApiInterface.getContactForHandle(address);
            return new Success(ctx, {
                message: "Successfully fetched contact details!",
                data
            }).send();
        } catch (ex: any) {
            if (ex.status) throw ex;
            throw new ServerError({
                message: "Failed to fetch contact details!",
                error: ex?.message ?? ex.toString()
            });
        }
    }

    static async getContactPhoto(ctx: RouterContext, _: Next) {
        try {
            const { address } = ctx.params;
            const quality = (ctx.request.query?.quality as string) === "thumbnail" ? "thumbnail" : "full";
            const data = await ContactPrivateApiInterface.getContactPhoto(address, quality);
            return new Success(ctx, {
                message: "Successfully fetched contact photo!",
                data
            }).send();
        } catch (ex: any) {
            if (ex.status) throw ex;
            throw new ServerError({
                message: "Failed to fetch contact photo!",
                error: ex?.message ?? ex.toString()
            });
        }
    }

    static async batchCheckIMessage(ctx: RouterContext, _: Next) {
        try {
            const { body } = ctx.request;
            const addresses = body?.addresses;
            if (!Array.isArray(addresses)) {
                throw new BadRequest({ error: "addresses must be an array of strings!" });
            }
            const data = await ContactPrivateApiInterface.batchCheckIMessage(addresses);
            return new Success(ctx, {
                message: "Successfully checked iMessage availability!",
                data
            }).send();
        } catch (ex: any) {
            if (ex.status) throw ex;
            throw new ServerError({
                message: "Failed to check iMessage availability!",
                error: ex?.message ?? ex.toString()
            });
        }
    }

    static async getHandleSiblings(ctx: RouterContext, _: Next) {
        try {
            const { address } = ctx.params;
            const data = await ContactPrivateApiInterface.getHandleSiblings(address);
            return new Success(ctx, {
                message: "Successfully fetched handle siblings!",
                data
            }).send();
        } catch (ex: any) {
            if (ex.status) throw ex;
            throw new ServerError({
                message: "Failed to fetch handle siblings!",
                error: ex?.message ?? ex.toString()
            });
        }
    }

    static async getSuggestedNames(ctx: RouterContext, _: Next) {
        try {
            const address = ctx.request.query?.address as string | undefined;
            const data = await ContactPrivateApiInterface.getSuggestedNames(address);
            return new Success(ctx, {
                message: "Successfully fetched suggested names!",
                data
            }).send();
        } catch (ex: any) {
            if (ex.status) throw ex;
            throw new ServerError({
                message: "Failed to fetch suggested names!",
                error: ex?.message ?? ex.toString()
            });
        }
    }

    static async getContactAvailability(ctx: RouterContext, _: Next) {
        try {
            const { address } = ctx.params;
            const data = await ContactPrivateApiInterface.getContactAvailability(address);
            return new Success(ctx, {
                message: "Successfully fetched contact availability!",
                data
            }).send();
        } catch (ex: any) {
            if (ex.status) throw ex;
            throw new ServerError({
                message: "Failed to fetch contact availability!",
                error: ex?.message ?? ex.toString()
            });
        }
    }

    static async detectBusiness(ctx: RouterContext, _: Next) {
        try {
            const { address } = ctx.params;
            const data = await ContactPrivateApiInterface.detectBusinessContact(address);
            return new Success(ctx, {
                message: "Successfully detected business contact!",
                data
            }).send();
        } catch (ex: any) {
            if (ex.status) throw ex;
            throw new ServerError({
                message: "Failed to detect business contact!",
                error: ex?.message ?? ex.toString()
            });
        }
    }
}
