import Monaco from "@monaco-editor/react";
import type * as monacoEditor from "monaco-editor/esm/vs/editor/editor.api";
import React, { useState, useRef, useEffect } from "react";
import { useRouteMatch, useLocation } from "react-router-dom";
import {
  logEvent,
  openByHash,
  newNotebookWithContent,
  logException,
  NotebookOptions,
} from "../firebase";
import { parseMD } from "../md";
import marked from "marked";
import { monospaceFont } from "../diagrams";

import { DropdownShare, closeMenu } from "../components/Dropdown";
import app from "firebase/app";
import {
  RepoForkedIcon,
  AlertIcon,
  MarkGithubIcon,
  DownloadIcon,
  MarkdownIcon,
} from "@primer/octicons-react";
import { download, slug } from "../helpers";
import UseAnimations from "react-useanimations";
import skipBack from "react-useanimations/lib/skipBack";
import { navigateTo } from "../Nav";
import { useAuth, GitHubUser } from "../Auth";
import { ResizeableSidebar } from "../components/Resize";
import { UserList } from "../components/UserList";
import { CreateMenu, UserMenu } from "src/components/UserMenu";
import { ErrorBoundary } from "src/components/ErrorBounday";
import { renderMarkdown } from "src/components/Markdown";
import { downloadZip } from "src/export";
import { Notebook } from "src/types";
import { SharingDetails } from "src/components/SharingDetails";
import { setupMonaco } from "src/dot-monarch";

declare var Firepad: any;
declare var monaco: typeof monacoEditor;

marked.setOptions({
  sanitize: true,
});

function saveSize(size: number) {
  localStorage.setItem("w-size", JSON.stringify({ size }));
}

function loadSize() {
  try {
    const stored = JSON.parse(localStorage.getItem("w-size") || "{}");
    if (
      typeof stored.size == "number" &&
      !isNaN(stored.size) &&
      stored.size >= 0
    ) {
      return stored.size;
    }
  } catch {}
  return window.innerWidth * 0.3;
}

function MakeCopyMenu(props: {
  loading: boolean;
  makeCopy: (options: NotebookOptions) => Promise<any>;
}) {
  const authCtx = useAuth();

  return (
    <details className="dropdown details-reset details-overlay d-inline-block mr-2">
      <summary aria-haspopup="true">
        <span className={`btn`}>
          <RepoForkedIcon size={16} />
          Make a copy
          {props.loading && <span className="AnimatedEllipsis"></span>}
          <div className="dropdown-caret"></div>
        </span>
      </summary>

      <ul className="dropdown-menu dropdown-menu-se" style={{ width: 300 }}>
        <li>
          <a
            className="dropdown-item"
            onClick={async () => {
              if (!authCtx.uid) {
                await authCtx.signin();
              }
              closeMenu();
              await props.makeCopy({ isPrivate: true, publicRead: false });
            }}
            href={document.location.toString()}
          >
            {authCtx.uid ? null : <MarkGithubIcon size={16} className="mr-2" />}
            <span>Make private copy</span>
          </a>
        </li>
        <li>
          <a
            className="dropdown-item"
            onClick={async () => {
              closeMenu();
              await props.makeCopy({ isPrivate: false, publicRead: true });
            }}
            href={document.location.toString()}
          >
            <span>Make public copy</span>
          </a>
        </li>
      </ul>
    </details>
  );
}

export function Editor(props: { readonly?: boolean; newModel?: boolean }) {
  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor>();

  const [firebaseRef, setFirebaseRef] = useState<app.database.Reference | null>(
    null
  );
  const [loadingCopy, setLoadingCopy] = useState<boolean>(false);
  const [loadingSave, setLoadingSave] = useState<boolean>(false);
  const [firepad, setFirepad] = useState<any>(null);
  const [md, setMd] = useState<marked.Token[]>([]);
  const [meta, setMeta] = useState<Notebook["meta"] | null>(null);
  const match = useRouteMatch<{ user: string; notebook: string }>();
  const location = useLocation();
  const authCtx = useAuth();

  const isOldModel = "notepadId" in match.params;
  let isReadonly = props.readonly || isOldModel || !meta || !meta.uid;

  if (
    meta &&
    meta.sharing &&
    meta.sharing.isPrivate &&
    meta.uid != authCtx.uid
  ) {
    isReadonly = true;
  }

  const [size, setSize] = useState(props.readonly ? 0 : loadSize());
  const [staticContent, setStaticContent] = useState<string>();
  const [, setIsEditorReady] = useState(false);
  const [author, setAuthor] = useState<GitHubUser | null>(null);

  let theTitle: string | null = null;

  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    setStaticContent(qs.get("t") || "");
    if (qs.has("open")) {
      setSize(loadSize());
    }
  }, [location.search]);

  const theme = isReadonly ? "disabled" : "enabled";

  const language = "markdown";

  function handleEditorDidMount(_getEditorValue: any, editor: any) {
    editorRef.current = editor;
    setIsEditorReady(true);

    editorRef.current!.onDidChangeModelContent((ev) => {
      const x = parseMD(editorRef.current!.getValue());
      setMd(x);
    });
  }

  useEffect(() => {
    if ("notebook" in match.params && match.params.notebook) {
      const ref = openByHash(match.params.user, match.params.notebook);
      setFirebaseRef(ref);
    } else {
      setFirebaseRef(null);
    }
  }, [match.url]);

  useEffect(() => {
    if (editorRef.current) {
      setupMonaco(monaco);
      monaco.editor.setTheme(theme);
      editorRef.current.render();

      theTitle = null;

      if (firepad) {
        firepad.dispose();
        editorRef.current.setValue("");
      }

      if (firebaseRef) {
        editorRef.current.setValue("");

        let options: any = {
          defaultText: "# Title\n```sequence\na->b: say hi\n```",
        };

        if (authCtx.uid) {
          options.userId = authCtx.uid;
        }

        if (isReadonly) {
          const headless = new Firepad.Headless(firebaseRef);
          headless.getText(function (text: string) {
            setStaticContent(text);
            headless.dispose();
          });
          setFirepad(null);
          editorRef.current.setValue(staticContent || "");
        } else {
          setFirepad(
            Firepad.fromMonaco(firebaseRef, editorRef.current, options)
          );
        }
      } else if (isReadonly && staticContent) {
        setFirepad(null);
        editorRef.current.setValue(staticContent || "");
      }
    }
  }, [editorRef.current, firebaseRef, staticContent, isReadonly]);

  useEffect(() => {
    if (firepad) {
      firepad.on("synced", function (isSynced: boolean) {
        setLoadingSave(!isSynced);
      });
    }
  }, [firepad]);

  useEffect(() => {
    if (firepad && authCtx.uid) {
      firepad.setUserId(authCtx.uid);
    }
  }, [authCtx.data]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.layout();
    }
  }, [size]);

  async function newNotebook(content: string, options: NotebookOptions) {
    setLoadingCopy(true);

    if (!authCtx.uid) {
      await authCtx.signin();
    }

    const ret = await newNotebookWithContent(content, options);
    const { ref, succeed, owner } = ret;
    setLoadingCopy(false);

    if (succeed) {
      logEvent("make_copy");
      setSize(loadSize());
      navigateTo(`/notebook/${owner}/${ref.key}`);
    }

    return ret;
  }

  async function makeCopy(options: NotebookOptions) {
    const val = editorRef.current!.getValue();
    return newNotebook(val, options);
  }

  let hadTitle = false;

  for (let elem of md) {
    if ("type" in elem && elem.type == "heading") {
      document.title = elem.text + " - Diagrams";
      theTitle = elem.text;
      hadTitle = true;
      break;
    }
  }

  if (!hadTitle) {
    document.title = "Untitled document - Diagrams";
  }

  const c = md.map(renderMarkdown);

  // function copyReadOnlyLink() {
  //   copyTextToClipboard(
  //     generateStaticLink(editorRef.current!.getValue()!)
  //   ).then(() => {
  //     editorRef.current!.focus();
  //     logEvent("share_ro");
  //     closeMenu();
  //   });
  // }

  // function copyEditableLink() {
  //   copyTextToClipboard(document.location.toString()).then(() => {
  //     editorRef.current!.focus();
  //     logEvent("share_editable");
  //     closeMenu();
  //   });
  // }

  useEffect(() => {
    if (firebaseRef) {
      firebaseRef.child("meta").once(
        "value",
        function (a) {
          setMeta((a.toJSON() as any) || null);
        },
        function (e) {
          console.error(e);
          logEvent("access_denied");
          navigateTo("/list");
        }
      );

      if (theTitle && !isReadonly) {
        firebaseRef.child("meta/title").set(theTitle, (err) => {
          err && console.log("err, cant set meta");
          if (err) logException(err);
        });
      }
    } else {
      setMeta(null);
    }
  }, [firebaseRef, theTitle]);

  useEffect(() => {
    if (meta) {
      app
        .database()
        .ref()
        .child(`users/${meta.uid}/profile`)
        .once("value", function (owner: any) {
          setAuthor(owner.toJSON());
        });
    }
  }, [meta]);

  return (
    <div className={size == 0 ? "fullscreen" : ""}>
      <ResizeableSidebar
        size={size}
        onResize={(n) => {
          setSize(n);
          saveSize(n);
        }}
      >
        <div
          className="tools d-flex flex-justify-between"
          style={{ width: size }}
        >
          <div className="p-2 d-flex">
            {author ? (
              <>
                <img
                  className="avatar avatar-small m-2"
                  alt={author.login}
                  src={`${author.avatar_url}&s=40`}
                  width="20"
                  height="20"
                  aria-label={author.login}
                />
                <div className="flex-self-center">
                  <span
                    style={{
                      fontFamily: monospaceFont,
                      fontWeight: "bold",
                    }}
                  >
                    {author.login}
                  </span>
                  {" / "}
                  <span className="css-truncate css-truncate-overflow">
                    {theTitle}
                  </span>
                </div>
              </>
            ) : (
              <>
                <img
                  className="avatar avatar-small m-2"
                  alt="anonymous"
                  src="https://user-images.githubusercontent.com/334891/29999089-2837c968-9009-11e7-92c1-6a7540a594d5.png"
                  width="20"
                  height="20"
                  aria-label="Sign in"
                />
                <div className="flex-self-center">
                  <span
                    style={{
                      fontFamily: monospaceFont,
                      fontWeight: "bold",
                    }}
                  >
                    anonymous
                  </span>
                  {" / "}
                  <span className="css-truncate css-truncate-overflow">
                    {theTitle}
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="p-2">
            {!authCtx.uid || !meta || authCtx.uid != meta.uid ? (
              <MakeCopyMenu loading={loadingCopy} makeCopy={makeCopy} />
            ) : null}
          </div>
        </div>
        <div className="editor" style={{ width: size }}>
          {isReadonly && (
            <div
              className="readonly-notice"
              style={{ borderBottom: "1px solid #dbdbda" }}
            >
              <div
                className="Toast Toast--warning"
                style={{
                  maxWidth: 1000,
                  width: "auto",
                }}
              >
                <span className="Toast-icon">
                  <AlertIcon size={16} />
                </span>
                <span className="Toast-content">
                  This is a read-only page. Make a copy to edit the document.
                </span>
              </div>
            </div>
          )}
          <ErrorBoundary>
            <Monaco
              theme={theme}
              language={language}
              loading={<div>Loading editor...</div>}
              value={""}
              editorDidMount={handleEditorDidMount}
              options={{
                fontFamily: monospaceFont,
                // fontSize: 13,
                lineNumbers: "on",
                minimap: { enabled: false },
                readOnly: !!isReadonly,
                automaticLayout: true,
              }}
            />
          </ErrorBoundary>
        </div>
      </ResizeableSidebar>
      <div className="content" style={{ left: size + 5 }}>
        <div className="top-bar content-bar d-flex flex-justify-between">
          <div className="p-2">
            <button
              className="btn btn-octicon tooltipped tooltipped-se mr-2"
              aria-label="Show or hide the code editor."
              onClick={() => {
                setSize(size == 0 ? loadSize() : 0);
              }}
            >
              <UseAnimations
                reverse={size == 0}
                animation={skipBack}
                size={24}
                strokeColor="#586069"
              />
            </button>

            {loadingSave && (
              <span className="m-1">
                <span>Saving</span>
                <span className="AnimatedEllipsis"></span>
              </span>
            )}
          </div>

          <div className="p-2 d-flex" style={{ alignItems: "center" }}>
            <UserList documentRef={firebaseRef} />
            <span className="ml-4">
              <SharingDetails meta={meta} />
            </span>
            <DropdownShare label="Export" className="btn-invisible">
              <li>
                <a
                  className="dropdown-item"
                  onClick={() => {
                    downloadZip(
                      theTitle || "diagrams",
                      editorRef.current!.getValue()
                    )
                      .then(() => {
                        logEvent("export-zip");
                        closeMenu();
                      })
                      .catch((e) => {
                        logException(e);
                      });
                  }}
                  href={document.location.toString()}
                >
                  <DownloadIcon size={16} className="mr-2" />
                  <span>Download zip</span>
                </a>
              </li>
              <li>
                <a
                  className="dropdown-item"
                  onClick={() => {
                    download(
                      `${slug(theTitle || "diagrams", {})}.md`,
                      editorRef.current!.getValue(),
                      "text/markdown"
                    );

                    logEvent("export-md");
                    closeMenu();
                  }}
                  href={document.location.toString()}
                >
                  <MarkdownIcon size={16} className="mr-2" />
                  <span>Download Markdown</span>
                </a>
              </li>
            </DropdownShare>
            {/* <DropdownShare label="Share" className="btn-invisible">
              {isReadonly || (
                <li>
                  <a
                    className="dropdown-item"
                    onClick={copyEditableLink}
                    href={document.location.toString()}
                  >
                    <LinkIcon size={16} className="mr-2" />
                    <span>Share link</span>
                  </a>
                </li>
              )}
            </DropdownShare> */}

            <CreateMenu newNotebook={newNotebook} />
            <UserMenu />
          </div>
        </div>
        <div className="scroll">
          <div className="markdown-body">{c}</div>
        </div>
      </div>
    </div>
  );
}
