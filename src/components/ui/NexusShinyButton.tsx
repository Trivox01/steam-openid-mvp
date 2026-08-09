import type {ButtonHTMLAttributes,ReactNode} from "react";

export type NexusShinyVariant="play"|"install"|"store"|"running"|"neutral"|"warning"|"danger";
export type NexusShinySize="compact"|"card"|"hero";
type Props=Omit<ButtonHTMLAttributes<HTMLButtonElement>,"children">&{label:string;icon:ReactNode;loading?:boolean;variant:NexusShinyVariant;size:NexusShinySize};

export function NexusShinyButton({label,icon,loading=false,variant,size,className="",...button}:Props){
 return <button {...button} className={`nexus-shiny-button nexus-shiny-button--${variant} nexus-shiny-button--${size} ${className}`.trim()} aria-busy={loading||undefined}>
  <span className="nexus-shiny-button__content">{icon}{size!=="compact"&&<span className="nexus-shiny-button__label">{label}</span>}</span>
 </button>
}
