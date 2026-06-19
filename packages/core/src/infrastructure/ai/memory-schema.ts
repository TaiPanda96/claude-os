import z from "zod";

export const memoryUpdateEnumType = z.enum(["merge", "append", "overwrite"]);
