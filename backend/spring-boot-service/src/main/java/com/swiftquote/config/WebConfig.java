package com.swiftquote.config;

import java.util.List;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.filter.UrlHandlerFilter;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.util.pattern.PathPatternParser;

/** Routing behaves like the Go service's Fiber router: case-insensitive, with an optional trailing slash. */
@Configuration(proxyBeanMethods = false)
class WebConfig implements WebMvcConfigurer {

	private final List<HandlerMethodArgumentResolver> resolvers;

	WebConfig(List<HandlerMethodArgumentResolver> resolvers) {
		this.resolvers = resolvers;
	}

	@Override
	public void addArgumentResolvers(List<HandlerMethodArgumentResolver> argumentResolvers) {
		argumentResolvers.addAll(this.resolvers);
	}

	@Override
	public void configurePathMatch(PathMatchConfigurer configurer) {
		PathPatternParser parser = new PathPatternParser();
		parser.setCaseSensitive(false);
		configurer.setPatternParser(parser);
	}

	@Bean
	FilterRegistrationBean<UrlHandlerFilter> trailingSlashFilter() {
		FilterRegistrationBean<UrlHandlerFilter> bean = new FilterRegistrationBean<>(
				UrlHandlerFilter.trailingSlashHandler("/**").wrapRequest().build());
		bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
		return bean;
	}

}
