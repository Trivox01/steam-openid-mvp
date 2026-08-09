import {useEffect,useRef,useState,type MouseEvent} from "react";
import {CircleAlert,CircleCheck,Download,ExternalLink,LoaderCircle,Play} from "lucide-react";
import {useTranslation} from "../../i18n/TranslationContext";
import {gameLauncher} from "../../services/compositionRoot";
import type {GameLaunchSnapshot,GameOwnership} from "../../services/GameLauncherService";
import {useGameSession} from "../../hooks/useGameSession";
import {NexusShinyButton,type NexusShinyVariant} from "../ui/NexusShinyButton";

export function GameActionButton({appId,title,owned,compact=false}:{appId?:string;title:string;owned?:boolean;compact?:boolean}){
 const{t}=useTranslation();const ownership:GameOwnership=owned===true?"owned":owned===false?"not_owned":"unknown";
 const[snapshot,setSnapshot]=useState<GameLaunchSnapshot>(()=>gameLauncher.getSnapshot(appId??""));
 const{isRunning:sessionRunning}=useGameSession(appId);
 const previousRunning=useRef(sessionRunning);
 useEffect(()=>{if(!appId)return;const unsubscribe=gameLauncher.subscribe(appId,setSnapshot);void gameLauncher.refresh(appId,ownership);const refocus=()=>void gameLauncher.refresh(appId,ownership,true);window.addEventListener("focus",refocus);return()=>{unsubscribe();window.removeEventListener("focus",refocus)}},[appId,ownership]);
 useEffect(()=>{if(!appId||previousRunning.current===sessionRunning)return;previousRunning.current=sessionRunning;void gameLauncher.refresh(appId,ownership)},[appId,ownership,sessionRunning]);
 const busy=snapshot.actionStatus==="openingSteam";const activeSession=sessionRunning||snapshot.availability==="running";const key=busy?"openingSteam":activeSession?"running":snapshot.availability;const label=t(`gameLauncher.${key}`,{title});
 const click=async(event:MouseEvent<HTMLButtonElement>)=>{event.stopPropagation();if(!appId||busy||activeSession)return;if(snapshot.availability==="steam_not_installed"&&!window.confirm(t("gameLauncher.installSteamConfirm")))return;if(snapshot.availability==="steam_not_installed")await gameLauncher.openSteamInstaller(appId);else await gameLauncher.act(appId,ownership)};
 return <><NexusShinyButton type="button" size={compact?"card":"hero"} variant={variant(snapshot,activeSession)} label={label} icon={<ActionIcon snapshot={snapshot} activeSession={activeSession}/>} onClick={click} disabled={!appId||busy||activeSession} loading={busy} aria-label={label} title={label}/><span className="sr-only" role="status" aria-live="polite">{label}</span></>
}
function variant(snapshot:GameLaunchSnapshot,activeSession:boolean):NexusShinyVariant{if(snapshot.actionStatus==="error"||snapshot.availability==="steam_unavailable"||snapshot.availability==="steam_not_installed")return"warning";if(activeSession)return"running";if(snapshot.action==="play")return"play";if(snapshot.action==="install")return"install";if(snapshot.action==="store")return"store";return"neutral"}
function ActionIcon({snapshot,activeSession}:{snapshot:GameLaunchSnapshot;activeSession:boolean}){if(snapshot.actionStatus==="openingSteam")return <LoaderCircle className="nexus-shiny-button__spinner" aria-hidden="true"/>;if(activeSession)return <CircleCheck aria-hidden="true"/>;if(snapshot.action==="install")return <Download aria-hidden="true"/>;if(snapshot.action==="store"||snapshot.action==="check"||snapshot.action==="installSteam")return <ExternalLink aria-hidden="true"/>;if(snapshot.actionStatus==="error")return <CircleAlert aria-hidden="true"/>;return <Play aria-hidden="true" fill="currentColor"/>}
