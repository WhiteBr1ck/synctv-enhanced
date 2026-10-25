import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { sortedPage } from "@/utils/list-sort";
import { ElNotification } from "element-plus";
import { roomStore } from "@/stores/room";
import { storeToRefs } from "pinia";
import {
  moviesApi,
  currentMovieApi,
  editMovieInfoApi,
  delMovieApi,
  swapMovieApi,
  changeCurrentMovieApi,
  clearMovieListApi,
  liveInfoApi
} from "@/services/apis/movie";
import type { EditMovieInfo, MovieInfo } from "@/types/Movie";
import { strLengthLimit } from "@/utils";

// 获取房间信息
const room = roomStore();

export const useMovieApi = (token: string, roomId: string) => {
  // 获取影片列表和正在播放的影片
  room.restoreBrowser(roomId);
  const {browserPage:currentPage,browserPageSize:pageSize,browserDynamic:dynamic}=storeToRefs(room);
  const savedMovieSort = useLocalStorage("synctv:movie-sort", "original");
  const movieSort = ref(savedMovieSort.value);
  watch(savedMovieSort, value => { movieSort.value = value; });
  const saveMovieSort = () => { savedMovieSort.value = movieSort.value; };
  const sorting = ref(false);
  let listingGeneration = 0;
  let listingRequest: AbortController | undefined;
  onBeforeUnmount(() => { ++listingGeneration; listingRequest?.abort(); });

  const switchDir = async (id: string, subPath?: string) => {
    currentPage.value = 1;
    room.browserKeyword='';
    movieSort.value = savedMovieSort.value;
    return await getMovies(id, subPath);
  };

  // 获取影片列表
  const { state: movies, execute: reqMoviesApi } = moviesApi();
  const moviesLoading = computed(() => sorting.value);
  const getMovies = async (id?: string, subPath?: string, keyword?: string) => {
    const generation = ++listingGeneration;
    listingRequest?.abort();
    const controller = listingRequest = new AbortController();
    const folderId = id === undefined ? room.lastFolderId : id;
    const folderSubPath = subPath === undefined ? (id === undefined ? room.lastFolderSubPath : '') : subPath;
    keyword=keyword===undefined?room.browserKeyword:keyword;
    sorting.value = true;
    try {
      const load = async (page: number, max: number) => {
        await reqMoviesApi({
        params: {
          page,
          max,
          subPath: folderSubPath,
          id: folderId,
          keyword: keyword
        },
        headers: {
          Authorization: token,
          "X-Room-Id": roomId
        },
        signal: controller.signal
        });
        if (generation !== listingGeneration) throw new Error("目录已切换");
        if (!movies.value) throw new Error("没有收到影片列表");
        return { ...movies.value, items: [...(movies.value.movies || [])] as MovieInfo[] };
      };
      const result = await sortedPage(load, currentPage.value, pageSize.value, movieSort.value,
        (item: MovieInfo) => ({ name: item.base.name, isDir: item.base.isFolder, type: item.base.type, size: item.base.fileSize,
          modified: item.base.modifiedAt, creation: item.base.fileCreatedAt, created: item.createAt }));
      if (generation !== listingGeneration) return;
      if (movieSort.value.startsWith('size-') && !result.items.some(item => item.base.vendorInfo?.vendor === 'alist')) {
        movieSort.value = 'name-asc';
      }
      if (result.dynamic && movieSort.value.startsWith('created-')) movieSort.value = 'name-asc';
      if (!result.dynamic && /^(creation|modified|size)-/.test(movieSort.value)) movieSort.value = 'name-asc';
      room.movies = result.items;
      room.totalMovies = result.total;
      room.folder = result.paths;
      dynamic.value = result.dynamic || false;
      room.browserSearchScope = result.searchScope || '';
      room.browserDateFields = result.dateFields;
    } catch (err: any) {
      if (generation !== listingGeneration) return;
      if(id===undefined&&folderId&&[400,403,404].includes(err.response?.status)){
        room.folder=undefined;room.browserKeyword='';currentPage.value=1;
        return getMovies('','','');
      }
      console.log(err);
      ElNotification({
        title: "获取影片列表失败",
        message: err.response?.data?.error || err.message,
        type: "error"
      });
    } finally {
      if (generation === listingGeneration) sorting.value = false;
    }
  };

  // 获取正在播放的影片
  const { state: currentMovie, execute: reqCurrentMovieApi, isLoading: isLoadingCurrent } =
    currentMovieApi();
  let currentGeneration=0;
  let currentRequest:AbortController|undefined;
  onBeforeUnmount(()=>{currentGeneration++;currentRequest?.abort();});
  const getCurrentMovie = async () => {
    const generation=++currentGeneration;
    currentRequest?.abort();
    const controller=currentRequest=new AbortController();
    try {
      await reqCurrentMovieApi({
        signal:controller.signal,
        headers: {
          Authorization: token,
          "X-Room-Id": roomId
        }
      });

      if (generation!==currentGeneration||!currentMovie.value) return;

      room.currentStatus = currentMovie.value.status;
      room.currentExpireId = currentMovie.value.expireId;

      if (currentMovie.value.movie.base.url.startsWith("/")) {
        currentMovie.value.movie.base.url = `${window.location.origin}${currentMovie.value.movie.base.url}`;
      }

      // 遍历currentMovie.value.movie.base.moreSources，moreSources是数组，而不是对象
      if (
        currentMovie.value.movie.base.moreSources &&
        currentMovie.value.movie.base.moreSources.length > 0
      ) {
        for (let i = 0; i < currentMovie.value.movie.base.moreSources.length; i++) {
          if (currentMovie.value.movie.base.moreSources[i].url.startsWith("/")) {
            currentMovie.value.movie.base.moreSources[i].url =
              `${window.location.origin}${currentMovie.value.movie.base.moreSources[i].url}`;
          }
        }
      }

      for (let key in currentMovie.value.movie.base.subtitles) {
        if (currentMovie.value.movie.base.subtitles[key].url.startsWith("/")) {
          currentMovie.value.movie.base.subtitles[key].url =
            `${window.location.origin}${currentMovie.value.movie.base.subtitles[key].url}`;
        }
      }
      room.currentMovie = currentMovie.value.movie;
    } catch (err: any) {
      if(controller.signal.aborted)return;
      console.log(err);
      ElNotification({
        title: "获取影片列表失败",
        message: err.response.data.error || err.message,
        type: "error"
      });
    }
  };

  // 交换两个影片的位置
  const selectMovies = ref<string[]>([]);
  const { execute: reqSwapMovieApi } = swapMovieApi();
  const swapMovie = async () => {
    try {
      await reqSwapMovieApi({
        data: {
          id1: selectMovies.value[0],
          id2: selectMovies.value[1]
        },
        headers: {
          Authorization: token,
          "X-Room-Id": roomId
        }
      });

      ElNotification({
        title: "交换成功",
        type: "success"
      });
      selectMovies.value = [];
      getMovies();
    } catch (err: any) {
      console.error(err);
      ElNotification({
        title: "交换失败",
        message: err.response.data.error || err.message,
        type: "error"
      });
    }
  };

  // 设置当前正在播放的影片
  const { execute: reqChangeCurrentMovieApi, isLoading: changeCurrentMovieLoading } =
    changeCurrentMovieApi();
  const changeCurrentMovie = async (id: string, showMsg = true, subPath = "") => {
    try {
      await reqChangeCurrentMovieApi({
        data: {
          id: id,
          subPath: subPath
        },
        headers: {
          Authorization: token,
          "X-Room-Id": roomId
        }
      });

      showMsg &&
        ElNotification({
          title: "设置成功",
          type: "success"
        });
    } catch (err: any) {
      console.error(err);
      showMsg &&
        ElNotification({
          title: "设置失败",
          message: err.response.data.error || err.message,
          type: "error"
        });
    }
  };

  // 当前影片信息
  const cMovieInfo = ref<EditMovieInfo>({
    id: "",
    url: "",
    name: "",
    live: false,
    proxy: false,
    rtmpSource: false,
    type: "",
    headers: {},
    subtitles: void 0,
    vendorInfo: void 0
  });

  // 编辑 Headers
  const updateHeaders = (header: { [key: string]: string }) => {
    cMovieInfo.value.headers = header;
  };

  // 编辑字幕
  const updateSubtitles = (
    subtitles: Record<
      string,
      {
        url: string;
        type: string;
      }
    >
  ) => {
    cMovieInfo.value.subtitles = subtitles;
  };

  // 编辑影片信息
  const { isLoading: editMovieInfoLoading, execute: reqEditMovieInfoApi } = editMovieInfoApi();
  const editMovieInfo = async () => {
    try {
      for (const key in cMovieInfo.value) {
        if (key === "headers" || key === "subtitles" || key === "vendorInfo") continue;
        strLengthLimit(key, 32);
      }
      await reqEditMovieInfoApi({
        data: cMovieInfo.value,
        headers: {
          Authorization: token,
          "X-Room-Id": roomId
        }
      });
      ElNotification({
        title: "更新成功",
        type: "success"
      });
    } catch (err: any) {
      console.error(err.message);
      ElNotification({
        title: "更新失败",
        type: "error",
        message: err.response.data.error || err.message
      });
    }
  };

  // 删除影片
  const { execute: reqDelMovieApi, isLoading: deleteMovieLoading } = delMovieApi();
  const deleteMovie = async (ids: Array<string>) => {
    try {
      await reqDelMovieApi({
        data: {
          ids: ids
        },
        headers: {
          Authorization: token,
          "X-Room-Id": roomId
        }
      });
      for (const id of ids) {
        room.movies.splice(
          room.movies.findIndex((movie: MovieInfo) => movie["id"] === id),
          1
        );
      }

      ElNotification({
        title: "删除成功",
        type: "success"
      });
      selectMovies.value = [];
    } catch (err: any) {
      console.error(err);
      ElNotification({
        title: "删除失败",
        message: err.response.data.error || err.message,
        type: "error"
      });
    }
  };

  // 清空影片列表
  const { execute: reqClearMovieListApi, isLoading: clearMovieListLoading } = clearMovieListApi();
  const clearMovieList = async () => {
    try {
      await reqClearMovieListApi({
        headers: {
          Authorization: token,
          "X-Room-Id": roomId
        },
        data: {
          parentId: room.lastFolderId
        }
      });

      ElNotification({
        title: "已清空",
        type: "success"
      });
    } catch (err: any) {
      console.error(err);
      ElNotification({
        title: "错误",
        message: err.response.data.error || err.message,
        type: "error"
      });
    }
  };

  // 获取推流信息
  const { state: liveInfo, execute: reqLiveInfoApi } = liveInfoApi();
  const getLiveInfo = async (id: string) => {
    try {
      await reqLiveInfoApi({
        data: {
          id: id
        },
        headers: {
          Authorization: token,
          "X-Room-Id": roomId
        }
      });
    } catch (err: any) {
      console.error(err);
      ElNotification({
        title: "获取失败",
        message: err.response.data.error || err.message,
        type: "error"
      });
    }
  };

  return {
    movieSort,
    saveMovieSort,
    currentPage,
    pageSize,
    // movieList,

    getMovies,
    movies,
    moviesLoading,

    getCurrentMovie,
    currentMovie,
    isLoadingCurrent,
    selectMovies,
    swapMovie,

    changeCurrentMovie,
    changeCurrentMovieLoading,

    cMovieInfo,
    updateHeaders,
    updateSubtitles,
    editMovieInfo,
    editMovieInfoLoading,

    deleteMovie,
    deleteMovieLoading,

    clearMovieList,
    clearMovieListLoading,

    getLiveInfo,
    liveInfo,

    switchDir,
    dynamic
  };
};
