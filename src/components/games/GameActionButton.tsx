import { useEffect,useState,type MouseEvent } from "react";
import {CircleAlert,CircleCheck,Download,ExternalLink,LoaderCircle,Play} from "lucide-react";
import {useTranslation} from "../../i18n/TranslationContext";
import {gameLauncher} from "../../services/compositionRoot";
import type {GameLaunchSnapshot,GameOwnership} from "../../services/GameLauncherService";

export function GameActionButton({appId,title,owned,compact=false}:{appId?:string;title:string;owned?:boolean;compact?:boolean}){
 const{t}=useTranslation();const ownership:GameOwnership=owned===true?"owned":owned===false?"not_owned":"unknown";
 const[snapshot,setSnapshot]=useState<GameLaunchSnapshot>(()=>gameLauncher.getSnapshot(appId??""));
 useEffect(()=>{if(!appId)return;const unsubscribe=gameLauncher.subscribe(appId,setSnapshot);void gameLauncher.refresh(appId,ownership);const refocus=()=>void gameLauncher.refresh(appId,ownership,true);window.addEventListener("focus",refocus);return()=>{unsubscribe();window.removeEventListener("focus",refocus)}},[appId,ownership]);
 const busy=snapshot.actionStatus==="openingSteam";const key=busy?"openingSteam":snapshot.availability;
 const label=t(`gameLauncher.${key}`,{title});
 const click=async(event:MouseEvent<HTMLButtonElement>)=>{event.stopPropagation();if(!appId||busy)return;if(snapshot.availability==="steam_not_installed"&&!window.confirm(t("gameLauncher.installSteamConfirm")))return;if(snapshot.availability==="steam_not_installed")await gameLauncher.openSteamInstaller(appId);else await gameLauncher.act(appId,ownership)};
 return <button type="button" className={`nexus-play-button ${compact?"nexus-play-button--compact":""}`} onClick={click} disabled={!appId||busy||snapshot.availability==="running"} aria-busy={busy||undefined} aria-label={label} title={label} data-status={snapshot.availability}><ActionIcon snapshot={snapshot}/>{!compact&&<span>{label}</span>}</button>
}
function ActionIcon({snapshot}:{snapshot:GameLaunchSnapshot}){if(snapshot.actionStatus==="openingSteam")return <LoaderCircle className="nexus-play-button__spinner" aria-hidden="true"/>;if(snapshot.availability==="running")return <CircleCheck aria-hidden="true"/>;if(snapshot.action==="install")return <Download aria-hidden="true"/>;if(snapshot.action==="store"||snapshot.action==="check"||snapshot.action==="installSteam")return <ExternalLink aria-hidden="true"/>;if(snapshot.actionStatus==="error")return <CircleAlert aria-hidden="true"/>;return <Play aria-hidden="true" fill="currentColor"/>}
