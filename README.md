### Baidu Cloud Engine BOS Uploader

bce-bos-uploader 是基于 [bce-sdk-js](https://github.com/baidubce/bce-sdk-js) 开发的一个 ui 组件，易用性更好。
DEMO地址是：<http://leeight.github.io/bce-bos-uploader/>

### 支持的浏览器

<http://caniuse.com/#feat=fileapi>

1. 桌面浏览器：IE10+, Firefox/Chrome/Opera 最新版
2. 移动设备上面的未经过完整测试，暂时不确定支持的范围

### 如何使用

```
bower install bce-bos-uploader
```

写一个最简单的页面：

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>bce-bos-uploader simple demo</title>
    <script src="./bower_components/jquery/dist/jquery.min.js"></script>
    <script src="./bower_components/bce-bos-uploader/bce-bos-uploader.bundle.js"></script>
  </head>
  <body>
    <input type="file" id="file"
           data-multi_selection="true"
           data-bos_bucket="baidubce"
           data-uptoken_url="http://127.0.0.1:1337/ack" />
    <script>new baidubce.bos.Uploader('#file');</script>
  </body>
</html>
```

> 关于 uptoken_url 应该如何实现，以及如何设置过 Bucket 的 CORS 属性，请参考 bce-sdk-js 的文档：[在浏览器中直接上传文件到bos](http://baidubce.github.io/bce-sdk-js/docs/advanced-topics-basic-example-in-browser.html#content) 和 [服务端签名](http://baidubce.github.io/bce-sdk-js/docs/advanced-topics-server-signature.html#content)

当然，也可以去掉 html tag 里面的 data 属性，直接用JS的方式来初始化：

```html
<input type="file" id="file" />
<script>
var uploader = new baidubce.bos.Uploader({
  browse_button: '#file',
  bos_bucket: 'baidubce',
  multi_selection: true,
  uptoken_url: 'http://127.0.0.1:1337/ack'
});
</script>
```


### 支持的配置参数

|*名称*|*是否必填*|*默认值*|*说明*|
|-----|---------|-------|-----|
|bos_bucket|Y|无|需要上传到的Bucket|
|uptoken_url|Y|无|用来进行服务端签名的URL，需要支持JSONP|
|browse_button|Y|无|需要初始化的`<input type="file"/>`|
|bos_endpoint|N|http://bos.bj.baidubce.com|BOS服务器的地址|
|bos_ak|N|无|如果没有设置`uptoken_url`的话，必须有`ak`和`sk`这个配置才可以工作|
|bos_sk|N|无|如果没有设置`uptoken_url`的话，必须有`ak`和`sk`这个配置才可以工作|
|uptoken|N|无|sts token的内容|
|auth_stripped_headers|N|['User-Agent', 'Connection']|如果计算签名的时候，需要剔除一些headers，可以配置这个参数|
|multi_selection|N|false|是否可以选择多个文件|
|max_retries|N|0|如果上传文件失败之后，支持的重试次数。默认不重试|
|auto_start|N|false|选择文件之后，是否自动上传|
|max_file_size|N|100M|可以选择的最大文件，超过这个值之后，会被忽略掉|
|bos_multipart_min_size|N|10M|超过这个值之后，采用分片上传的策略。如果想让所有的文件都采用分片上传，把这个值设置为0即可|
|chunk_size|N|4M|分片上传的时候，每个分片的大小（如果没有切换到分片上传的策略，这个值没意义）|
|bos_multipart_auto_continue|N|true|是否开启断点续传，如果设置成false，则UploadResume和UploadResumeError事件不会生效|

下列属性暂时不支持，看用户反馈再进行升级

|*名称*|*是否必填*|*默认值*|*说明*|
|-----|---------|-------|-----|
|filters|N|无|文件的过滤条件|
|get_new_uptoken|N|无|是否每次需要获取签名|
|save_key|-|-|-|
|domain|-|-|-|
|container|-|-|-|
|flash_swf_url|-|-|Flash文件的地址|
|dragdrop|-|-|-|
|drop_element|-|-|-|

### 支持的事件

在初始化 uploader 的时候，可以通过设置 init 来传递一些 回掉函数，然后 uploader 在合适的时机，会调用这些回掉函数，然后传递必要的参数。例如：

```js
var uploader = new baidubce.bos.Uploader({
  init: {
    PostInit: function () {
      // uploader 初始化完毕之后，调用这个函数
    },
    Key: function (_, file) {
      // 如果需要重命名 BOS 存储的文件名称，这个函数
      // 返回新的文件名即可
    },
    FilesAdded: function (_, files) {
      // 当文件被加入到队列里面，调用这个函数
    },
    FilesFilter: function (_, files) {
      // 如果需要对加入到队列里面的文件，进行过滤，可以在
      // 这个函数里面实现自己的逻辑
      // 返回值需要是一个数组，里面保留需要添加到队列的文件
    },
    BeforeUpload: function (_, file) {
      // 当某个文件开始上传的时候，调用这个函数
      // 如果想组织这个文件的上传，请返回 false
    },
    UploadProgress: function (_, file, progress, event) {
      // 文件的上传进度
    },
    FileUploaded: function (_, file, info) {
      // 文件上传成功之后，调用这个函数
    },
    UploadPartProgress: function (_, file, progress, event) {
      // 分片上传的时候，单个分片的上传进度
    },
    Error: function (_, error, file) {
      // 如果上传的过程中出错了，调用这个函数
    },
    UploadComplete: function () {
      // 队列里面的文件上传结束了，调用这个函数
    },
    UploadResume: function (_, file, partList, event) {
      // 断点续传生效时，调用这个函数，partList表示上次中断时，已上传完成的分块列表
    },
    UploadResumeError: function (_, file, error, event) {
      // 尝试进行断点续传失败时，调用这个函数
    }
  }
});
```

> 需要注意的时候，所以回掉函数里面的一个参数，暂时都是 null，因此上面的例子中用 _ 代替，后续可能会升级


### 对外提供的接口


#### start()

当 auto_start 设置为 false 的时候，需要手工调用 `start` 来开启上传的工作。

#### stop()

调用 stop 之后，会终止对文件队列的处理。需要注意的是，不是立即停止上传，而是等到当前的文件处理结束（成功/失败）之后，才会停下来。
