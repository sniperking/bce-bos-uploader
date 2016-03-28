/**
 * Copyright (c) 2014 Baidu.com, Inc. All Rights Reserved
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 *
 * @file uploader.js
 * @author leeight
 */

var sdk = require('bce-sdk-js');
var u = require('underscore');
var async = require('async');
var debug = require('debug')('bce-bos-uploader');

var utils = require('./utils');

var kDefaultOptions = {
    runtimes: 'html5',

    // bos服务器的地址，默认（http://bos.bj.baidubce.com）
    bos_endpoint: 'http://bos.bj.baidubce.com',

    // 默认的 ak 和 sk 配置
    bos_credentials: null,

    // 是否支持多选，默认（false）
    multi_selection: false,

    // 失败之后重试的次数（单个文件或者分片），默认（0），不重试
    max_retries: 0,

    // 是否自动上传，默认（false）
    auto_start: false,

    // 最大可以选择的文件大小，默认（100M）
    max_file_size: '100mb',

    // 超过这个文件大小之后，开始使用分片上传，默认（10M）
    bos_multipart_min_size: '10mb',

    // 分片上传的时候，并行上传的个数，默认（1）
    bos_multipart_parallel: 1,

    // 计算签名的时候，有些 header 需要剔除，减少传输的体积
    auth_stripped_headers: ['User-Agent', 'Connection'],

    // 分片上传的时候，每个分片的大小，默认（4M）
    chunk_size: '4mb',

    // 分块上传时,是否允许断点续传，默认（true）
    bos_multipart_auto_continue: true
};

var kPostInit = 'PostInit';
var kKey = 'Key';

// var kFilesRemoved   = 'FilesRemoved';
var kFileFiltered = 'FileFiltered';
var kFilesAdded = 'FilesAdded';
var kFilesFilter = 'FilesFilter';

var kBeforeUpload = 'BeforeUpload';
// var kUploadFile     = 'UploadFile';       // ??
var kUploadProgress = 'UploadProgress';
var kFileUploaded = 'FileUploaded';
var kUploadPartProgress = 'UploadPartProgress';
var kUploadResume = 'UploadResume'; // 断点续传
var kUploadResumeError = 'UploadResumeError'; // 尝试断点续传失败

var kError = 'Error';
var kUploadComplete = 'UploadComplete';

/**
 * BCE BOS Uploader
 *
 * @constructor
 * @param {Object|string} options 配置参数
 */
function Uploader(options) {
    // 已经支持的参数
    // options.runtimes
    // options.browse_button
    // options.uptoken_url
    // options.uptoken
    // options.max_file_size
    // options.max_retries
    // options.chunk_size
    // options.auto_start
    // options.bos_endpoint
    // options.bos_bucket
    // options.bos_multipart_min_size
    // options.bos_multipart_auto_continue
    // options.multi_selection
    // options.init.PostInit
    // options.init.FileFiltered
    // options.init.FilesAdded
    // options.init.BeforeUpload
    // options.init.UploadProgress
    // options.init.FileUploaded
    // options.init.Error
    // options.init.UploadComplete

    // 暂时不支持的参数
    // options.filters
    // options.get_new_uptoken
    // options.unique_names
    // options.save_key
    // options.domain
    // options.container
    // options.flash_swf_url
    // options.dragdrop
    // options.drop_element
    // options.init.Key

    if (u.isString(options)) {
        // 支持简便的写法，可以从 DOM 里面分析相关的配置.
        options = u.extend({
            browse_button: options,
            auto_start: true
        }, $(options).data());
    }

    this.options = u.extend({}, kDefaultOptions, options);
    this.options.max_file_size = utils.parseSize(this.options.max_file_size);
    this.options.bos_multipart_min_size
        = utils.parseSize(this.options.bos_multipart_min_size);
    this.options.chunk_size = this._resetChunkSize(
        utils.parseSize(this.options.chunk_size));

    var credentials = this.options.bos_credentials;
    if (!credentials && this.options.bos_ak && this.options.bos_sk) {
        credentials = {
            ak: this.options.bos_ak,
            sk: this.options.bos_sk
        };
    }

    /**
     * @type {sdk.BosClient}
     */
    this.client = new sdk.BosClient({
        endpoint: this.options.bos_endpoint,
        credentials: credentials,
        sessionToken: this.options.uptoken
    });

    if (this.options.uptoken_url) {
        this.client.createSignature = this._getCustomizedSignature(this.options.uptoken_url);
    }

    /**
     * 需要等待上传的文件列表，每次上传的时候，从这里面删除
     * 成功或者失败都不会再放回去了
     * @param {Array.<File>}
     */
    this._files = [];

    /**
     * 当前正在上传的文件.
     * @type {File}
     */
    this._currentFile = null;

    /**
     * 是否被中断了，比如 this.stop
     * @type {boolean}
     */
    this._abort = false;

    /**
     * 是否处于上传的过程中，也就是正在处理 this._files 队列的内容.
     * @type {boolean}
     */
    this._working = false;

    this._init();
}

Uploader.prototype._resetChunkSize = function (chunkSize) {
    // TODO
    return chunkSize;
};

Uploader.prototype._getCustomizedSignature = function (uptokenUrl) {
    var options = this.options;

    return function (_, httpMethod, path, params, headers) {
        if (/\bed=([\w\.]+)\b/.test(location.search)) {
            headers.Host = RegExp.$1;
        }

        if (u.isArray(options.auth_stripped_headers)) {
            headers = u.omit(headers, options.auth_stripped_headers);
        }

        var deferred = sdk.Q.defer();
        $.ajax({
            url: uptokenUrl,
            jsonp: 'callback',
            dataType: 'jsonp',
            data: {
                httpMethod: httpMethod,
                path: path,
                // delay: ~~(Math.random() * 10),
                params: JSON.stringify(params || {}),
                headers: JSON.stringify(headers || {})
            },
            success: function (payload) {
                if (payload.statusCode === 200 && payload.signature) {
                    deferred.resolve(payload.signature, payload.xbceDate);
                }
                else {
                    // TODO(leeight) timeout
                    deferred.reject(new Error('createSignature failed, statusCode = ' + payload.statusCode));
                }
            }
        });
        return deferred.promise;
    };
};

/**
 * 调用 this.options.init 里面配置的方法
 *
 * @param {string} methodName 方法名称
 * @param {Array.<*>} args 调用时候的参数.
 * @return {*} 事件的返回值.
 */
Uploader.prototype._invoke = function (methodName, args) {
    var init = this.options.init || this.options.Init;
    if (!init) {
        return;
    }

    var method = init[methodName];
    if (typeof method !== 'function') {
        return;
    }

    try {
        return method.apply(null, args == null ? [] : args);
    }
    catch (ex) {
        debug('%s(%j) -> %s', methodName, args, ex);
    }
};

/**
 * 初始化控件.
 */
Uploader.prototype._init = function () {
    var btn = $(this.options.browse_button);
    if (btn.attr('multiple') == null) {
        // 如果用户没有显示的设置过 multiple，使用 multi_selection 的设置
        // 否则保留 <input multiple /> 的内容
        btn.attr('multiple', !!this.options.multi_selection);
    }
    btn.on('change', u.bind(this._onFilesAdded, this));

    this.client.on('progress', u.bind(this._onUploadProgress, this));
    // XXX 必须绑定 error 的处理函数，否则会 throw new Error
    this.client.on('error', u.bind(this._onError, this));

    this._invoke(kPostInit);
};

Uploader.prototype._filterFiles = function (candidates) {
    var self = this;

    // 如果 maxFileSize === 0 就说明不限制大小
    var maxFileSize = this.options.max_file_size;

    var files = u.filter(candidates, function (file) {
        if (maxFileSize > 0 && file.size > maxFileSize) {
            self._invoke(kFileFiltered, [null, file]);
            return false;
        }

        // TODO
        // 检查后缀之类的

        return true;
    });

    return this._invoke(kFilesFilter, [null, files]) || files;
};

Uploader.prototype._onFilesAdded = function (e) {
    var files = this._filterFiles(e.target.files);
    if (u.isArray(files) && files.length) {
        this._invoke(kFilesAdded, [null, files]);
        this._files.push.apply(this._files, files);
    }

    if (this.options.auto_start) {
        this.start();
    }
};

Uploader.prototype._onError = function (e) {
    debug(e);
    // this._invoke(kError, [null, e, this._currentFile]);
};

Uploader.prototype._onUploadProgress = function (e) {
    var progress = e.lengthComputable
        ? e.loaded / e.total
        : 0;
    // FIXME(leeight) 这种判断方法不太合适.
    if (this.client._httpAgent
        && this.client._httpAgent._req
        && this.client._httpAgent._req._headers) {
        var headers = this.client._httpAgent._req._headers;

        var partNumber = headers['x-bce-meta-part-number'];
        if (partNumber != null) {
            this._invoke(kUploadPartProgress, [null, this._currentFile, progress, e]);
            return;
        }
    }

    this._invoke(kUploadProgress, [null, this._currentFile, progress, e]);
};

Uploader.prototype.start = function () {
    if (this._working) {
        return;
    }

    if (this._files.length) {
        this._working = true;
        this._uploadNext(this._getNext());
    }
};

Uploader.prototype.stop = function () {
    this._abort = true;
    this._working = false;
};

/**
 * 如果已经上传完毕了，返回 undefined
 *
 * @return {File|undefined}
 */
Uploader.prototype._getNext = function () {
    return this._files.shift();
};

Uploader.prototype._guessContentType = function (file) {
    var contentType = file.type;
    if (!contentType) {
        var object = file.name;
        var ext = object.split(/\./g).pop();
        contentType = sdk.MimeType.guess(ext);
    }

    // Firefox在POST的时候，Content-Type 一定会有Charset的，因此
    // 这里不管3721，都加上.
    if (!/charset=/.test(contentType)) {
        contentType += '; charset=UTF-8';
    }

    return contentType;
};

Uploader.prototype._uploadNextViaMultipart = function (file) {
    var bucket = this.options.bos_bucket;
    var object = file.name;

    var contentType = this._guessContentType(file);
    var options = {
        'Content-Type': contentType
    };

    var self = this;
    var uploadId = null;
    var multipartParallel = this.options.bos_multipart_parallel;
    var chunkSize = this.options.chunk_size;

    var returnValue = this._invoke(kBeforeUpload, [null, file]);
    if (returnValue === false) {
        return this._uploadNext(this._getNext());
    }

    // 可能会重命名
    returnValue = this._invoke(kKey, [null, file]);
    object = returnValue || object;
    this._initiateMultipartUpload(file, chunkSize, bucket, object, options)
        .then(function (response) {
            uploadId = response.body.uploadId;
            var parts = response.body.parts || [];
            // 准备 uploadParts
            var deferred = sdk.Q.defer();
            var tasks = utils.getTasks(file, uploadId, chunkSize, bucket, object);
            utils.filterTasks(tasks, parts);

            var loaded = parts.length;
            // 这个用来记录整体 Parts 的上传进度，不是单个 Part 的上传进度
            // 单个 Part 的上传进度可以监听 kUploadPartProgress 来得到
            var state = {
                lengthComputable: true,
                loaded: loaded,
                total: tasks.length
            };
            if (loaded) {
                self._invoke(kUploadProgress, [null, file, loaded / tasks.length, null]);
            }

            async.mapLimit(tasks, multipartParallel, self._uploadPart(state),
                function (err, results) {
                    if (err) {
                        deferred.reject(err);
                    }
                    else {
                        deferred.resolve(results);
                    }
                });

            return deferred.promise;
        })
        .then(function (responses) {
            var partList = [];
            u.each(responses, function (response, index) {
                partList.push({
                    partNumber: index + 1,
                    eTag: response.http_headers.etag
                });
            });
            // 全部上传结束后删除localStorage
            utils.generateLocalKey({
                blob: file,
                chunkSize: chunkSize,
                bucket: bucket,
                object: object
            }).then(function (localSaveKey) {
                utils.removeUploadId(localSaveKey);
            });
            return self.client.completeMultipartUpload(bucket, object, uploadId, partList);
        })
        .then(function (response) {
            response.body.bucket = bucket;
            response.body.object = object;
            self._invoke(kFileUploaded, [null, file, response]);
        })
        .catch(function (error) {
            self._invoke(kError, [null, error, file]);
        })
        .fin(function () {
            // 上传结束（成功/失败），开始下一个
            return self._uploadNext(self._getNext());
        });
};

Uploader.prototype._initiateMultipartUpload = function (file, chunkSize, bucket, object, options) {
    var self = this;
    var uploadId;
    var localSaveKey;

    function initNewMultipartUpload() {
        return self.client.initiateMultipartUpload(bucket, object, options)
            .then(function (response) {
                if (localSaveKey) {
                    utils.setUploadId(localSaveKey, response.body.uploadId);
                }

                response.body.parts = [];
                return response;
            });
    }

    var keyOptions = {
        blob: file,
        chunkSize: chunkSize,
        bucket: bucket,
        object: object
    };
    var promise = this.options.bos_multipart_auto_continue
        ? utils.generateLocalKey(keyOptions)
        : sdk.Q.resolve(null);

    return promise.then(function (key) {
            localSaveKey = key;
            if (!localSaveKey) {
                return initNewMultipartUpload();
            }

            uploadId = utils.getUploadId(localSaveKey);
            if (!uploadId) {
                return initNewMultipartUpload();
            }

            return self.client.listParts(bucket, object, uploadId);
        })
        .then(function (response) {
            if (uploadId && localSaveKey) {
                var parts = response.body.parts;
                // listParts 的返回结果
                self._invoke(kUploadResume, [null, file, parts, null]);
                response.body.uploadId = uploadId;
            }
            return response;
        })
        .catch(function (error) {
            if (uploadId && localSaveKey) {
                // 如果获取已上传分片失败，则重新上传。
                self._invoke(kUploadResumeError, [null, file, error, null]);
                utils.removeUploadId(localSaveKey);
                return initNewMultipartUpload();
            }
            throw error;
        });
};

Uploader.prototype._uploadPart = function (state) {
    var self = this;

    function uploadPartInner(item, opt_maxRetries) {
        if (item.etag) {
            // 跳过已上传的part
            return sdk.Q.resolve({
                http_headers: {
                    etag: item.etag
                },
                body: {}
            });
        }
        var maxRetries = opt_maxRetries == null
            ? self.options.max_retries
            : opt_maxRetries;

        var blob = item.file.slice(item.start, item.stop + 1);
        var options = {
            'x-bce-meta-part-number': item.partNumber
        };
        return self.client.uploadPartFromBlob(item.bucket, item.object, item.uploadId,
            item.partNumber, item.partSize, blob, options)
            .then(function (response) {
                ++state.loaded;
                var progress = state.loaded / state.total;
                self._invoke(kUploadProgress, [null, self._currentFile, progress, null]);
                return response;
            })
            .catch(function (error) {
                if (maxRetries > 0) {
                    // 还有重试的机会
                    return uploadPartInner(item, maxRetries - 1);
                }
                // 没有机会重试了 :-(
                throw error;
            });

    }

    return function (item, callback) {
        // file: file,
        // uploadId: uploadId,
        // bucket: bucket,
        // object: object,
        // partNumber: partNumber,
        // partSize: partSize,
        // start: offset,
        // stop: offset + partSize - 1

        var resolve = function (response) {
            callback(null, response);
        };
        var reject = function (error) {
            callback(error);
        };

        uploadPartInner(item).then(resolve, reject);
    };
};

Uploader.prototype._uploadNext = function (file, opt_maxRetries) {
    if (file == null || this._abort) {
        // 自动结束了 或者 人为结束了
        this._working = false;
        this._invoke(kUploadComplete);
        return;
    }

    // 设置一下当前正在上传的文件，progress 事件需要用到
    this._currentFile = file;

    // 判断一下应该采用何种方式来上传
    var multipartMinSize = this.options.bos_multipart_min_size;
    if (file.size > multipartMinSize) {
        return this._uploadNextViaMultipart(file);
    }

    // Upload By PUT OBJECT
    var bucket = this.options.bos_bucket;
    var object = file.name;

    var contentType = this._guessContentType(file);
    var options = {
        'Content-Type': contentType
    };

    var self = this;
    var maxRetries = opt_maxRetries == null
        ? this.options.max_retries
        : opt_maxRetries;
    var returnValue = this._invoke(kBeforeUpload, [null, file]);
    if (returnValue === false) {
        return this._uploadNext(this._getNext());
    }

    // 可能会重命名
    returnValue = this._invoke(kKey, [null, file]);
    object = returnValue || object;

    return this.client.putObjectFromBlob(bucket, object, file, options)
        .then(function (response) {
            if (file.size <= 0) {
                // 如果文件大小为0，不会触发 xhr 的 progress 事件，因此
                // 在上传成功之后，手工触发一次
                self._invoke(kUploadProgress, [null, file, 1]);
            }
            response.body.bucket = bucket;
            response.body.object = object;
            self._invoke(kFileUploaded, [null, file, response]);
            // 上传成功，开始下一个
            return self._uploadNext(self._getNext());
        })
        .catch(function (error) {
            self._invoke(kError, [null, error, file]);
            if (error.status_code && error.code && error.request_id) {
                // 应该是正常的错误（比如签名异常），这种情况就不要重试了
                return self._uploadNext(self._getNext());
            }
            else if (maxRetries > 0) {
                // 还有几乎重试
                return self._uploadNext(file, maxRetries - 1);
            }
            // 重试结束了，不管了，继续下一个文件的上传
            return self._uploadNext(self._getNext());
        });
};

Uploader.prototype._listParts = function (bucket, object, uploadId) {
    return this.client.listParts(bucket, object, uploadId)
        .then(function (response) {
            return response.body.parts;
        });
};

module.exports = Uploader;

/* vim: set ts=4 sw=4 sts=4 tw=120: */
