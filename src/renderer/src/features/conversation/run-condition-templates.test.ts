import { describe, expect, it } from "vitest";
import { fillRunConditionTemplate, RUN_CONDITION_TEMPLATES, shellQuote } from "./run-condition-templates";

const template = (id: string) => {
  const found = RUN_CONDITION_TEMPLATES.find((item) => item.id === id);
  if (!found) throw new Error(`missing template ${id}`);
  return found;
};

describe("run condition templates", () => {
  it("fills a template without a placeholder as is", () => {
    expect(fillRunConditionTemplate(template("new-commit"))).toEqual({
      command: "git log -1 --format=%H",
      when: "output-changes",
    });
  });

  it("quotes a path with spaces", () => {
    expect(fillRunConditionTemplate(template("new-file"), "/Users/me/My Files")).toEqual({
      command: "ls -t '/Users/me/My Files' | head -1",
      when: "output-changes",
    });
  });

  it("escapes single quotes and keeps shell characters inert", () => {
    expect(shellQuote("it's $(rm -rf ~)")).toBe(`'it'\\''s $(rm -rf ~)'`);
    expect(fillRunConditionTemplate(template("file-exists"), "/tmp/a'b c")).toEqual({
      command: `test -f '/tmp/a'\\''b c'`,
      when: "exit-zero",
    });
  });

  it("writes a leading tilde as $HOME outside the quotes", () => {
    expect(fillRunConditionTemplate(template("new-file"), "~/My Downloads")).toEqual({
      command: `ls -t "$HOME"/'My Downloads' | head -1`,
      when: "output-changes",
    });
    expect(shellQuote("~")).toBe('"$HOME"');
    expect(shellQuote("~bob/x")).toBe("'~bob/x'");
  });

  it("does not fill a placeholder template with an empty value", () => {
    expect(fillRunConditionTemplate(template("page-changed"), "  ")).toBeNull();
  });
});
