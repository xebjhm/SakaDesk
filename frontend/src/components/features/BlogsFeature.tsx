// frontend/src/components/features/BlogsFeature.tsx
import React, { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { BlogMember, BlogMeta, BlogContentResponse } from '../../types';
import { getBlogMembers, getBlogList, getBlogContent } from '../../api/blogs';
import { useAppStore } from '../../stores/appStore';

type ViewState =
    | { view: 'members' }
    | { view: 'list'; member: BlogMember }
    | { view: 'reader'; entry: BlogMeta; member: BlogMember; content: BlogContentResponse | null };

export const BlogsFeature: React.FC = () => {
    const { activeService } = useAppStore();
    const [viewState, setViewState] = useState<ViewState>({ view: 'members' });
    const [members, setMembers] = useState<BlogMember[]>([]);
    const [entries, setEntries] = useState<BlogMeta[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset to members view when service changes
    useEffect(() => {
        setViewState({ view: 'members' });
        setMembers([]);
        setEntries([]);
        setError(null);
    }, [activeService]);

    // Load members when in members view
    useEffect(() => {
        if (viewState.view !== 'members' || !activeService) return;

        setLoading(true);
        setError(null);
        getBlogMembers(activeService)
            .then(res => setMembers(res.members))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [viewState.view, activeService]);

    // Load entries when in list view
    useEffect(() => {
        if (viewState.view !== 'list' || !activeService) return;

        setLoading(true);
        setError(null);
        getBlogList(activeService, viewState.member.id)
            .then(res => setEntries(res.blogs))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [viewState, activeService]);

    // Load content when entering reader view
    useEffect(() => {
        if (viewState.view !== 'reader' || !activeService || viewState.content) return;

        setLoading(true);
        setError(null);
        getBlogContent(activeService, viewState.entry.id)
            .then(content => {
                setViewState(prev =>
                    prev.view === 'reader' ? { ...prev, content } : prev
                );
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [viewState, activeService]);

    if (!activeService) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500">
                Select a service to view blogs
            </div>
        );
    }

    const handleSelectMember = (member: BlogMember) => {
        setViewState({ view: 'list', member });
    };

    const handleSelectEntry = (entry: BlogMeta) => {
        if (viewState.view === 'list') {
            setViewState({ view: 'reader', entry, member: viewState.member, content: null });
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
            {/* Breadcrumb */}
            <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 text-sm shrink-0">
                <button
                    onClick={() => setViewState({ view: 'members' })}
                    className="text-blue-600 hover:underline"
                >
                    Blogs
                </button>
                {viewState.view !== 'members' && (
                    <>
                        <span className="text-gray-400">/</span>
                        <button
                            onClick={() => {
                                if (viewState.view === 'reader') {
                                    setViewState({ view: 'list', member: viewState.member });
                                }
                            }}
                            className={viewState.view === 'reader' ? "text-blue-600 hover:underline" : "text-gray-700"}
                        >
                            {viewState.member.name}
                        </button>
                    </>
                )}
                {viewState.view === 'reader' && (
                    <>
                        <span className="text-gray-400">/</span>
                        <span className="text-gray-700 truncate max-w-xs">{viewState.entry.title}</span>
                    </>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {/* Loading */}
                {loading && (
                    <div className="flex items-center justify-center h-32">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                    </div>
                )}

                {/* Error */}
                {error && !loading && (
                    <div className="p-4 text-center">
                        <p className="text-red-600 mb-2">{error}</p>
                        <button
                            onClick={() => {
                                setError(null);
                                // Force reload by resetting to members
                                setViewState({ view: 'members' });
                            }}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Members Grid */}
                {viewState.view === 'members' && !loading && !error && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">
                        {members.map(member => (
                            <button
                                key={member.id}
                                onClick={() => handleSelectMember(member)}
                                className="flex flex-col items-center p-3 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center mb-2">
                                    <span className="text-lg font-medium text-gray-600">
                                        {member.name.substring(0, 2)}
                                    </span>
                                </div>
                                <span className="text-sm text-gray-700 text-center">{member.name}</span>
                            </button>
                        ))}
                        {members.length === 0 && (
                            <div className="col-span-full text-center text-gray-500 py-8">
                                No blog members found
                            </div>
                        )}
                    </div>
                )}

                {/* Blog List */}
                {viewState.view === 'list' && !loading && !error && (
                    <div className="divide-y divide-gray-100">
                        {entries.map(entry => (
                            <button
                                key={entry.id}
                                onClick={() => handleSelectEntry(entry)}
                                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                            >
                                <h3 className="font-medium text-gray-900 line-clamp-2">{entry.title}</h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    {new Date(entry.published_at).toLocaleDateString('ja-JP', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                    })}
                                </p>
                            </button>
                        ))}
                        {entries.length === 0 && (
                            <div className="p-4 text-gray-500 text-center">No blog entries found</div>
                        )}
                    </div>
                )}

                {/* Blog Reader */}
                {viewState.view === 'reader' && !loading && !error && viewState.content && (
                    <article className="max-w-3xl mx-auto px-4 py-6">
                        <header className="mb-6">
                            <h1 className="text-2xl font-bold text-gray-900 mb-2">
                                {viewState.content.meta.title}
                            </h1>
                            <div className="flex items-center gap-3 text-sm text-gray-500">
                                <span>{viewState.content.meta.member_name}</span>
                                <span>-</span>
                                <time>
                                    {new Date(viewState.content.meta.published_at).toLocaleDateString('ja-JP', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </time>
                            </div>
                        </header>

                        {/* Blog content - render HTML safely with DOMPurify */}
                        <div
                            className="prose prose-sm max-w-none [&_img]:max-w-full [&_img]:h-auto"
                            dangerouslySetInnerHTML={{
                                __html: DOMPurify.sanitize(viewState.content.content.html, {
                                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'img', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li'],
                                    ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel'],
                                })
                            }}
                        />

                        {/* External link */}
                        <footer className="mt-8 pt-4 border-t border-gray-200">
                            <a
                                href={viewState.content.meta.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline text-sm"
                            >
                                View original post →
                            </a>
                        </footer>
                    </article>
                )}
            </div>
        </div>
    );
};
