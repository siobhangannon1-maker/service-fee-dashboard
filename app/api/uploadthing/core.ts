import { createUploadthing, type FileRouter } from "uploadthing/next";

const f = createUploadthing();

export const ourFileRouter = {
  communicationCallUploader: f({
    audio: {
      maxFileSize: "64MB",
      maxFileCount: 1,
    },
  }).onUploadComplete(async ({ file }) => {
    return {
      uploadedFileUrl: file.url,
      fileName: file.name,
    };
  }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;