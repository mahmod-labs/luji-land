CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Enrollment_childId_key" ON "Enrollment"("childId");

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_childId_fkey"
    FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_classroomId_fkey"
    FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Capacity is enforced in the database, not in service code, so it holds under
-- a concurrent race (rule: DB-side constraint). A naive count-then-insert in
-- the app lets two enrollments at the limit both read count=19 and both commit.
--
-- Why this is race-safe: the trigger takes a row lock on the target Classroom
-- (SELECT ... FOR UPDATE) before counting. Concurrent enrollments into the same
-- room serialize on that lock — the second blocks until the first commits, then
-- counts the row the first inserted and sees the room full. The lock is
-- per-classroom, so enrollments into different rooms never contend.
CREATE OR REPLACE FUNCTION enforce_room_capacity() RETURNS TRIGGER AS $$
DECLARE
    room_capacity INTEGER;
    current_count INTEGER;
BEGIN
    SELECT "capacity" INTO room_capacity
        FROM "Classroom" WHERE "id" = NEW."classroomId" FOR UPDATE;

    IF room_capacity IS NULL THEN
        RAISE EXCEPTION 'classroom % does not exist', NEW."classroomId"
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT count(*) INTO current_count
        FROM "Enrollment" WHERE "classroomId" = NEW."classroomId";

    IF current_count >= room_capacity THEN
        RAISE EXCEPTION 'classroom % is at capacity (%)', NEW."classroomId", room_capacity
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_room_capacity_trigger
    BEFORE INSERT ON "Enrollment"
    FOR EACH ROW EXECUTE FUNCTION enforce_room_capacity();
