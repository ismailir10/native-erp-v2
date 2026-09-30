-- A control note remembers the control detail it answered; a changed detail no longer counts as acknowledged (null = older notes).
ALTER TABLE "ControlAck" ADD COLUMN "detail" TEXT;
