import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/server/auth/guards";
import {
  getTemplate,
  PAGE_SIZES,
  type TemplateField,
} from "@/server/services/certificates";
import { getFileRecord } from "@/server/services/storage";
import {
  TemplateEditor,
  type EditorField,
} from "@/components/teach/templates/template-editor";

export const metadata: Metadata = { title: "Editor de plantilla" };

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const user = await requireTeacher();
  const { templateId } = await params;

  const template = getTemplate(templateId);
  if (!template) notFound();
  if (user.role !== "admin" && template.ownerId !== user.id) notFound();

  let background: { fileId: string; name: string; isPdf: boolean } | null = null;
  if (template.backgroundFileId) {
    const record = getFileRecord(template.backgroundFileId);
    if (record) {
      background = {
        fileId: record.id,
        name: record.originalName,
        isPdf:
          record.originalName.toLowerCase().endsWith(".pdf") ||
          record.mimeType === "application/pdf",
      };
    }
  }

  return (
    <TemplateEditor
      template={{
        id: template.id,
        name: template.name,
        pageSize: template.pageSize,
        orientation: template.orientation,
        fields: ((template.fields as TemplateField[] | null) ?? []) as EditorField[],
        decor: template.decor,
      }}
      background={background}
      pageSizes={PAGE_SIZES}
    />
  );
}
