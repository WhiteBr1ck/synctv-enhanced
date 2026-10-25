import { ref, computed, reactive, watch } from "vue";
import { defineStore } from "pinia";
import { useStorage } from "@vueuse/core";
import { useRouteParams } from "@vueuse/router";
import { useLocalStorage } from "@vueuse/core";
import type { CurrentMovie, MovieInfo } from "@/types/Movie";
import { userStore } from "@/stores/user";
import type { Status } from "@/proto/message";
import type { MyInfo } from "@/types/Room";
import type { MoviePath } from "@/services/apis/movie";
const { token: userToken } = userStore();
export const roomStore = defineStore("roomStore", () => {
  const isDarkMode = useStorage<boolean>("isDarkMode", localStorage.isDarkMode === "true");

  const login = computed(() => {
    return userToken.value !== "";
  });

  const myInfo = ref<MyInfo>();

  // 影片列表
  const movies = ref<MovieInfo[]>([]);

  // roomID
  const roomID = computed(() => {
    return useRouteParams<string>("roomId");
  });

  const totalMovies = ref(0);

  const currentMovie = ref<MovieInfo>({
    id: "",
    base: {
      url: "",
      name: "",
      live: false,
      proxy: false,
      rtmpSource: false,
      type: "",
      headers: {}
    },
    createAt: 0,
    creator: "",
    subPath: ""
  });
  const currentStatus = ref<Status>({
    isPlaying: false,
    currentTime: 0,
    playbackRate: 1
  });
  const currentExpireId = ref<number>(0);

  // 是否主动上报
  const play = ref(true);

  // 在线人数
  const viewerCount = ref(1);

  const folder = ref<MoviePath[]>();
  const browserSearchScope = ref<'current' | ''>('');
  const browserPage=ref(1),browserPageSize=ref(10),browserKeyword=ref(''),browserDynamic=ref(false);
  const browserStates=useLocalStorage<Record<string,{folder:MoviePath[];page:number;size:number;keyword:string}>>('synctv:room-browsers',{});
  let browserRoom='';
  const restoreBrowser=(id:string)=>{
    if(browserRoom===id&&folder.value)return;
    browserRoom=id;
    const saved=browserStates.value?.[id];
    folder.value=Array.isArray(saved?.folder)?saved.folder.filter(p=>typeof p.id==='string'&&typeof p.name==='string').slice(0,32):undefined;
    browserPage.value=Number.isInteger(saved?.page)&&saved.page>0?saved.page:1;
    browserPageSize.value=[10,20,30,40,50,100].includes(saved?.size)?saved.size:10;
    browserKeyword.value=typeof saved?.keyword==='string'?saved.keyword:'';
    browserDynamic.value=false;
    browserSearchScope.value='';
  };
  watch([folder,browserPage,browserPageSize,browserKeyword],()=>{
    if(browserRoom&&folder.value)browserStates.value[browserRoom]={folder:folder.value,page:browserPage.value,size:browserPageSize.value,keyword:browserKeyword.value};
  },{deep:true});

  const lastFolderId = computed(() => {
    return folder.value && folder.value.length > 0 ? folder.value[folder.value.length - 1].id : "";
  });
  const lastFolderSubPath = computed(() => {
    return folder.value && folder.value.length > 0
      ? folder.value[folder.value.length - 1].subPath
      : "";
  });

  return {
    isDarkMode,
    movies,
    totalMovies,
    currentMovie,
    currentStatus,
    currentExpireId,
    play,
    viewerCount,
    login,
    myInfo,
    roomID,
    folder,
    restoreBrowser,browserPage,browserPageSize,browserKeyword,browserDynamic,browserSearchScope,
    lastFolderId,
    lastFolderSubPath
  };
});
