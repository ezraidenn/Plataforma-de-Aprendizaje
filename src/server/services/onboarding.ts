import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { courseItems, courses, enrollments } from "@/server/db/schema";
import type { OnboardingFacts } from "@/lib/onboarding";
import { listStudents } from "./courses";

/** Hechos para la banda de primeros pasos, sobre lo PROPIO del usuario. */
export function onboardingFacts(userId: string): OnboardingFacts {
  const own = eq(courses.ownerId, userId);
  const has = (q: { get(): unknown }) => q.get() !== undefined;
  const latest = db.select({ id: courses.id }).from(courses).where(own).orderBy(desc(courses.updatedAt)).limit(1).get();
  return {
    hasCourse: latest !== undefined,
    hasLesson: has(db.select({ id: courseItems.id }).from(courseItems).innerJoin(courses, eq(courseItems.courseId, courses.id)).where(and(own, sql`${courseItems.kind} != 'folder'`)).limit(1)),
    hasStudent: listStudents({ kind: "own", ownerId: userId }, { page: 1, pageSize: 1 }).total > 0,
    hasPublishedWithEnrollment: has(db.select({ id: enrollments.id }).from(enrollments).innerJoin(courses, eq(enrollments.courseId, courses.id)).where(and(own, eq(courses.status, "published"), sql`${enrollments.status} != 'dropped'`)).limit(1)),
    hasTemplate: has(db.select({ id: courses.id }).from(courses).where(and(own, sql`${courses.certificateTemplateId} IS NOT NULL`)).limit(1)),
    latestCourseId: latest?.id ?? null,
  };
}
