import { createOpdsRuntime, getPlatformService } from "@readany/core";

export const createOpdsMobileRuntime = createOpdsRuntime;

export const opdsMobileRuntime = createOpdsMobileRuntime(getPlatformService);
