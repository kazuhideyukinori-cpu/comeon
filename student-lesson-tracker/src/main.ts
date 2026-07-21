import "./style.css";
import { mountCoachView } from "./coach-view.ts";
import { mountStudentView } from "./student-view.ts";

const app = document.querySelector<HTMLElement>("#app")!;

function route(): void {
  const hash = location.hash;
  const studentMatch = hash.match(/^#\/s\/(.+)$/);
  if (studentMatch) {
    void mountStudentView(app, decodeURIComponent(studentMatch[1]));
  } else {
    mountCoachView(app);
  }
}

window.addEventListener("hashchange", route);
route();
