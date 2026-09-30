import { z } from "zod";
import {
  generationCommandVersionV3,
  newMenuGenerationRequestSchema,
  regenerateMenuRequestSchema,
} from "../../../shared/contracts/generation.js";

/** 同期受付と背景処理の両方で同じ厳格な command を検証する。 */
export const menuEndpointBodySchema = z.discriminatedUnion("kind", [
  z
    .object({
      commandVersion: z.literal(generationCommandVersionV3),
      kind: z.literal("new_menu"),
      qualityMode: z.boolean(),
      request: newMenuGenerationRequestSchema,
    })
    .strict(),
  z
    .object({
      commandVersion: z.literal(generationCommandVersionV3),
      kind: z.literal("regenerate_menu"),
      qualityMode: z.boolean(),
      request: regenerateMenuRequestSchema,
    })
    .strict(),
]);
export type MenuGenerationCommand = z.infer<typeof menuEndpointBodySchema>;
export const menuBackgroundBodySchema = z
  .object({ token: z.uuid(), command: menuEndpointBodySchema })
  .strict();
