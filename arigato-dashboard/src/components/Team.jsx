import { useState } from "react";
import { Leaf } from "lucide-react";
import { PageHeader } from "./ui";

// Photos: drop a square image at public/team/<id>.jpg and it replaces the initials avatar
const TEAM = [
  {
    id: "anurag-dwivedi",
    name: "Anurag Dwivedi",
    role: "Software Development",
    focus: ["Frontend & Backend", "AI/ML Integration", "Dashboard Development"],
  },
  {
    id: "navya-nawal",
    name: "Navya Nawal",
    role: "Research & Design",
    focus: ["Agricultural Research", "UI/UX Design", "Farmer Outreach"],
  },
  {
    id: "gaurav-s",
    name: "Gaurav S",
    role: "Hardware & IoT",
    focus: ["Sensor Integration", "Edge Device Development", "Real-time Data Collection"],
  },
  {
    id: "kk-praveen",
    name: "KK Praveen",
    role: "Data & Analysis",
    focus: ["Crop & Market Data", "Revenue Modelling", "Domain Knowledge"],
  },
];

const initials = (name) =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function Avatar({ member, index }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`team-avatar hue-${index % 4}`}>
      {!failed ? (
        <img src={`/team/${member.id}.jpg`} alt={member.name} onError={() => setFailed(true)} />
      ) : (
        <span>{initials(member.name)}</span>
      )}
    </div>
  );
}

export default function Team() {
  return (
    <div className="page">
      <PageHeader title="Our Team" subtitle="Building a sustainable future for agriculture" />

      <div className="team-grid">
        {TEAM.map((m, i) => (
          <article key={m.id} className="card team-card">
            <Avatar member={m} index={i} />
            <h3>{m.name}</h3>
            <span className="team-role">{m.role}</span>
            <ul>
              {m.focus.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="card team-mission">
        <span className="brand-mark"><Leaf size={22} /></span>
        <p>
          KRISHI SETU helps smallholder farmers earn more from the land they already have — by pairing live locality
          data and low-cost field sensors with clear, crop-by-crop guidance.
        </p>
      </div>
    </div>
  );
}
