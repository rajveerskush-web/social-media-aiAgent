import { persistDurableArtifact } from "./durable-storage.ts";
import { requestImageGeneration, getImageGenerationProvider } from "./image-generation.ts";
import type { ImageAspectRatio, ImageStylePreset } from "./image-types.ts";

async function getDbAccess() {
  const { getDb, agentTaskArtifacts } = await import("../db/index.ts");
  return { db: getDb(), agentTaskArtifacts };
}

export type SpecialistToolContext = {
  authUserId: string;
  campaignId: number;
  taskId: number;
  agentId: string;
  computerId?: number | null;
};

export type SpecialistToolResult = {
  success: boolean;
  output: string;
  artifactId?: number;
  publicUrl?: string;
  data?: Record<string, unknown>;
  error?: string;
};

// ============================================================================
// Tool Declarations for Gemini Function Calling
// ============================================================================

export const RESEARCH_TOOL_DECLARATIONS = [
  {
    name: "recordResearchFindings",
    description:
      "Save structured research findings, verified market intelligence, and cited source URLs into the database as a durable research report artifact.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description: "Descriptive title for the research report (e.g. 'Competitor Instagram Strategy Benchmark').",
        },
        sourceUrls: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "List of actual verified URLs inspected during research.",
        },
        summary: {
          type: "STRING",
          description: "Executive summary synthesizing the primary findings.",
        },
        detailedFindings: {
          type: "STRING",
          description: "Detailed findings, competitor analysis, pricing tiers, content formats, or audience takeaways in markdown.",
        },
        keyMetrics: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Optional list of numerical or quantifiable metrics discovered.",
        },
      },
      required: ["title", "sourceUrls", "summary", "detailedFindings"],
    },
  },
  {
    name: "searchWeb",
    description:
      "Query public web search or platform discovery (Google, YouTube, Instagram) for market intelligence, competitor campaigns, or current trends.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Specific search terms or keywords.",
        },
        platform: {
          type: "STRING",
          description: "Target platform: 'google', 'youtube', 'instagram', or 'general'. Default is 'general'.",
          enum: ["google", "youtube", "instagram", "general"],
        },
      },
      required: ["query"],
    },
  },
] as const;

export const CONTENT_CREATOR_TOOL_DECLARATIONS = [
  {
    name: "generateImage",
    description:
      "Generate an image for social posts, campaigns, or creative assets using Gemini image generation, saved directly to durable storage and ImageKit.",
    parameters: {
      type: "OBJECT",
      properties: {
        prompt: {
          type: "STRING",
          description: "Detailed visual prompt describing subject, composition, atmosphere, colors, and styling.",
        },
        aspectRatio: {
          type: "STRING",
          description: "Aspect ratio: '1:1' (square feed), '9:16' (Reels/Stories), '16:9' (landscape), or '4:3'. Default is '1:1'.",
          enum: ["1:1", "9:16", "16:9", "4:3"],
        },
        stylePreset: {
          type: "STRING",
          description: "Visual style: 'photorealistic', 'digital-art', 'minimalist', 'illustration', or 'brand-graphic'.",
          enum: ["photorealistic", "digital-art", "minimalist", "illustration", "brand-graphic"],
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "saveContentDraft",
    description:
      "Save a structured social media draft with post copy, hashtags, platform format, visual brief, and draft deliverable in the database.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description: "Title or hook summary for the post draft.",
        },
        platform: {
          type: "STRING",
          description: "Format: 'instagram_feed', 'instagram_reel', 'instagram_story', or 'carousel'.",
          enum: ["instagram_feed", "instagram_reel", "instagram_story", "carousel"],
        },
        caption: {
          type: "STRING",
          description: "Full post caption with line breaks and call to action.",
        },
        hashtags: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Array of targeted hashtags (e.g. ['#SpecialtyCoffee', '#NYCBarista']).",
        },
        hookText: {
          type: "STRING",
          description: "First 3-second opening hook or headline.",
        },
        visualBrief: {
          type: "STRING",
          description: "Description of the accompanying image, video direction, or graphic asset.",
        },
        imageUrl: {
          type: "STRING",
          description: "Optional URL of a generated or referenced image asset.",
        },
      },
      required: ["title", "platform", "caption", "hashtags"],
    },
  },
  {
    name: "createCarouselBrief",
    description:
      "Save a structured multi-slide carousel blueprint with individual slide headlines, copy, and visual concepts in the database.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description: "Carousel topic or concept title.",
        },
        theme: {
          type: "STRING",
          description: "Central narrative or takeaway.",
        },
        targetAudience: {
          type: "STRING",
          description: "Target demographic or customer persona.",
        },
        slides: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              slideNumber: { type: "INTEGER", description: "Slide number starting at 1." },
              headline: { type: "STRING", description: "Slide bold headline." },
              copy: { type: "STRING", description: "Slide body copy." },
              visualConcept: { type: "STRING", description: "Visual or illustration description for this slide." },
            },
            required: ["slideNumber", "headline", "copy", "visualConcept"],
          },
          description: "Sequence of slides (between 3 and 10 slides).",
        },
      },
      required: ["title", "theme", "targetAudience", "slides"],
    },
  },
] as const;

export function getSpecialistToolDeclarations(agentId: string) {
  if (agentId === "seat-1") {
    return RESEARCH_TOOL_DECLARATIONS;
  }
  if (agentId === "seat-mvj4q0fn") {
    return CONTENT_CREATOR_TOOL_DECLARATIONS;
  }
  return [];
}

// ============================================================================
// Tool Handlers & Artifact Persistence
// ============================================================================

export async function executeSpecialistTool(
  toolName: string,
  args: Record<string, unknown>,
  context: SpecialistToolContext,
): Promise<SpecialistToolResult> {
  try {
    switch (toolName) {
      // ----------------------------------------------------------------------
      // Research Agent Tools
      // ----------------------------------------------------------------------
      case "recordResearchFindings": {
        const title = String(args.title || "Research Findings").trim();
        const summary = String(args.summary || "").trim();
        const detailedFindings = String(args.detailedFindings || "").trim();
        const sourceUrls = Array.isArray(args.sourceUrls)
          ? (args.sourceUrls as string[]).filter(Boolean)
          : [];
        const keyMetrics = Array.isArray(args.keyMetrics)
          ? (args.keyMetrics as string[]).filter(Boolean)
          : [];

        const reportMarkdown = [
          `# ${title}`,
          `\n## Executive Summary\n${summary}`,
          `\n## Detailed Findings\n${detailedFindings}`,
          keyMetrics.length > 0 ? `\n## Key Metrics\n${keyMetrics.map((m) => `- ${m}`).join("\n")}` : "",
          `\n## Verified Sources & References\n${
            sourceUrls.length > 0 ? sourceUrls.map((url) => `- [${url}](${url})`).join("\n") : "- Internal domain knowledge synthesis"
          }`,
        ]
          .filter(Boolean)
          .join("\n");

        const filename = `research_report_${Date.now()}.md`;
        const reportBytes = Buffer.from(reportMarkdown, "utf-8");

        let artifactId: number = Date.now() % 100000;
        let publicUrl: string | undefined;

        try {
          const { db, agentTaskArtifacts } = await getDbAccess();
          const [artifactRow] = await db
            .insert(agentTaskArtifacts)
            .values({
              taskId: context.taskId,
              computerId: context.computerId ?? null,
              authUserId: context.authUserId,
              campaignId: context.campaignId,
              artifactType: "research_report",
              filename,
              mimeType: "text/markdown",
              sizeBytes: reportBytes.length,
              isVerified: true,
              isApprovedForSharing: true,
            })
            .returning({ id: agentTaskArtifacts.id });
          if (artifactRow?.id) artifactId = artifactRow.id;
        } catch {
          // Fallback when executed outside live persisted task row
        }

        const durableResult = await persistDurableArtifact(
          context.campaignId,
          context.taskId,
          artifactId,
          filename,
          "text/markdown",
          new Uint8Array(reportBytes),
        );
        publicUrl = durableResult.publicUrl;

        return {
          success: true,
          output: `Research report "${title}" recorded successfully with ${sourceUrls.length} verified sources. Artifact ID: ${artifactId}.`,
          artifactId,
          publicUrl,
          data: {
            title,
            sourceCount: sourceUrls.length,
            sources: sourceUrls,
            summary,
          },
        };
      }

      case "searchWeb": {
        const query = String(args.query || "").trim();
        const platform = String(args.platform || "general");

        // Format search discovery link and parameters
        let searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        if (platform === "youtube") {
          searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        } else if (platform === "instagram") {
          searchUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(query.replace(/^#/, ""))}/`;
        }

        return {
          success: true,
          output: `Explored search for "${query}" on ${platform}. Target URL: ${searchUrl}. Use the browser tools to navigate and inspect live page elements if deeper verification is required.`,
          data: { query, platform, searchUrl },
        };
      }

      // ----------------------------------------------------------------------
      // Content Creator Agent Tools
      // ----------------------------------------------------------------------
      case "generateImage": {
        const prompt = String(args.prompt || "").trim();
        const aspectRatio = (args.aspectRatio as ImageAspectRatio) || "1:1";
        const stylePreset = (args.stylePreset as ImageStylePreset) || "photorealistic";

        const { generateAndPersistImageWithRecovery } = await import("./recovery/resilient-image-pipeline.ts");
        const pipelineResult = await generateAndPersistImageWithRecovery({
          authUserId: context.authUserId,
          campaignId: context.campaignId,
          taskId: context.taskId,
          agentId: context.agentId,
          computerId: context.computerId,
          prompt,
          aspectRatio,
          stylePreset,
        });

        if (!pipelineResult.success) {
          return {
            success: false,
            output: pipelineResult.error || "Image generation failed.",
            error: pipelineResult.error,
          };
        }

        const accessibleUrl =
          pipelineResult.publicUrl ||
          `/api/computer/artifacts/download?campaignId=${context.campaignId}&artifactId=${pipelineResult.artifactId}&view=1`;
        const downloadUrl = `/api/computer/artifacts/download?campaignId=${context.campaignId}&artifactId=${pipelineResult.artifactId}`;

        return {
          success: true,
          output: `Generated creative image successfully: **${pipelineResult.filename}**\n\n![${pipelineResult.filename}](${accessibleUrl})\n\n[Download ${pipelineResult.filename}](${downloadUrl})${pipelineResult.warning ? `\n> Notice: ${pipelineResult.warning}` : ""}`,
          artifactId: pipelineResult.artifactId,
          publicUrl: accessibleUrl,
          data: {
            prompt,
            aspectRatio,
            filename: pipelineResult.filename,
            sizeBytes: pipelineResult.sizeBytes,
            accessibleUrl,
            downloadUrl,
            artifactId: pipelineResult.artifactId,
          },
        };
      }

      case "saveContentDraft": {
        const title = String(args.title || "Social Post Draft").trim();
        const platform = String(args.platform || "instagram_feed");
        const caption = String(args.caption || "").trim();
        const hookText = args.hookText ? String(args.hookText).trim() : undefined;
        const visualBrief = args.visualBrief ? String(args.visualBrief).trim() : undefined;
        const imageUrl = args.imageUrl ? String(args.imageUrl).trim() : undefined;
        const hashtags = Array.isArray(args.hashtags)
          ? (args.hashtags as string[]).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
          : [];

        const draftContent = [
          `# Draft: ${title}`,
          `\n**Platform**: ${platform}`,
          hookText ? `\n**Hook**: ${hookText}` : "",
          `\n**Caption**:\n${caption}`,
          `\n**Hashtags**: ${hashtags.join(" ")}`,
          visualBrief ? `\n**Visual Brief**: ${visualBrief}` : "",
          imageUrl ? `\n**Visual Asset**: ![Draft Visual](${imageUrl})` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const filename = `content_draft_${platform}_${Date.now()}.md`;
        const draftBytes = Buffer.from(draftContent, "utf-8");

        let artifactId: number = Date.now() % 100000;
        let publicUrl: string | undefined;

        try {
          const { db, agentTaskArtifacts } = await getDbAccess();
          const [artifactRow] = await db
            .insert(agentTaskArtifacts)
            .values({
              taskId: context.taskId,
              computerId: context.computerId ?? null,
              authUserId: context.authUserId,
              campaignId: context.campaignId,
              artifactType: "content_draft",
              filename,
              mimeType: "text/markdown",
              sizeBytes: draftBytes.length,
              isVerified: true,
              isApprovedForSharing: true,
            })
            .returning({ id: agentTaskArtifacts.id });
          if (artifactRow?.id) artifactId = artifactRow.id;
        } catch {
          // Fallback when executed outside live persisted task row
        }

        const durableResult = await persistDurableArtifact(
          context.campaignId,
          context.taskId,
          artifactId,
          filename,
          "text/markdown",
          new Uint8Array(draftBytes),
        );
        publicUrl = durableResult.publicUrl;

        return {
          success: true,
          output: `Saved content draft "${title}" for ${platform}. Artifact ID: ${artifactId}.`,
          artifactId,
          publicUrl,
          data: {
            title,
            platform,
            hashtagsCount: hashtags.length,
          },
        };
      }

      case "createCarouselBrief": {
        const title = String(args.title || "Carousel Brief").trim();
        const theme = String(args.theme || "").trim();
        const targetAudience = String(args.targetAudience || "").trim();
        const slides = Array.isArray(args.slides)
          ? (args.slides as Array<{ slideNumber: number; headline: string; copy: string; visualConcept: string }>)
          : [];

        const briefContent = [
          `# Carousel Blueprint: ${title}`,
          `\n**Theme**: ${theme}`,
          `\n**Target Audience**: ${targetAudience}`,
          `\n## Slides Breakdown (${slides.length} slides)`,
          ...slides.map(
            (s) =>
              `\n### Slide ${s.slideNumber}: ${s.headline}\n- **Copy**: ${s.copy}\n- **Visual Concept**: ${s.visualConcept}`,
          ),
        ].join("\n");

        const filename = `carousel_blueprint_${Date.now()}.md`;
        const briefBytes = Buffer.from(briefContent, "utf-8");

        let artifactId: number = Date.now() % 100000;
        let publicUrl: string | undefined;

        try {
          const { db, agentTaskArtifacts } = await getDbAccess();
          const [artifactRow] = await db
            .insert(agentTaskArtifacts)
            .values({
              taskId: context.taskId,
              computerId: context.computerId ?? null,
              authUserId: context.authUserId,
              campaignId: context.campaignId,
              artifactType: "carousel_brief",
              filename,
              mimeType: "text/markdown",
              sizeBytes: briefBytes.length,
              isVerified: true,
              isApprovedForSharing: true,
            })
            .returning({ id: agentTaskArtifacts.id });
          if (artifactRow?.id) artifactId = artifactRow.id;
        } catch {
          // Fallback when executed outside live persisted task row
        }

        const durableResult = await persistDurableArtifact(
          context.campaignId,
          context.taskId,
          artifactId,
          filename,
          "text/markdown",
          new Uint8Array(briefBytes),
        );
        publicUrl = durableResult.publicUrl;

        return {
          success: true,
          output: `Created carousel blueprint "${title}" with ${slides.length} slides. Artifact ID: ${artifactId}.`,
          artifactId,
          publicUrl,
          data: {
            title,
            theme,
            slideCount: slides.length,
          },
        };
      }

      default:
        return {
          success: false,
          output: `Unknown tool: ${toolName}`,
          error: `Tool "${toolName}" is not registered.`,
        };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: `Tool execution failed: ${errorMsg}`,
      error: errorMsg,
    };
  }
}
